# Blue/Green Deployment Guide

This guide explains how to trigger, monitor, and roll back blue/green deployments
for the backend ECS service using AWS CodeDeploy.

---

## Overview

Blue/green deployments eliminate downtime by:

1. Deploying the new container image to a **green** target group while the
   existing (blue) tasks continue serving all production traffic.
2. CodeDeploy routes health-check traffic through a dedicated **test listener**
   (port 8080) against the green target group.
3. Once the green target group passes its health checks, CodeDeploy atomically
   shifts all production traffic (port 80) to the green group.
4. The original blue tasks remain registered and ready for a fast rollback for
   `termination_wait_time_in_minutes` (default: 30 min) before they are
   terminated.
5. If health checks fail at any point, or the CloudWatch healthy-host alarm
   fires, CodeDeploy rolls back automatically by switching the production
   listener back to the blue group — no new deployment needed.

---

## Architecture

```
                        Port 80  (production)
Users ──────────────► ALB Listener ──────────────► Blue TG  (current)
                                                         or
                                        ──────────────► Green TG (new, after shift)

CodeDeploy health     Port 8080 (test)
checks ─────────────► ALB Listener ──────────────► Green TG  (new)
```

### Resources created when `enable_blue_green = true`

| Resource | Name pattern |
|---|---|
| `aws_codedeploy_app` | `<prefix>-ecs-app` |
| `aws_codedeploy_deployment_config` | `<prefix>-ecs-deployment-config` |
| `aws_codedeploy_deployment_group` | `<prefix>-deployment-group` |
| `aws_lb_target_group` (green) | `<prefix>-tg-green` |
| `aws_lb_listener` (test, 8080) | — |
| `aws_cloudwatch_metric_alarm` | `<prefix>-deployment-alarm` |
| `aws_sns_topic` | `<prefix>-deployment-notifications` |
| `aws_iam_role` (CodeDeploy) | `<prefix>-codedeploy-role` |

---

## Configuration

### Enabling per workspace

| Workspace | `enable_blue_green` | Deployment type |
|---|---|---|
| `staging` | `false` | Rolling (ECS native) |
| `production` | `true` | Blue/Green (CodeDeploy) |

Set in the workspace-specific tfvars files:

```hcl
# production.tfvars
enable_blue_green = {
  production = true
}
```

### Tuning deployment behaviour

```hcl
# Root variables.tf / tfvars override
blue_green_deployment_config = {
  # How long (minutes) to keep blue tasks alive after a successful shift.
  # Shorter = cheaper; longer = faster manual rollback window.
  termination_wait_time_in_minutes = 30

  deployment_ready_option = {
    # CONTINUE_DEPLOYMENT – shift traffic immediately after health checks pass.
    # STOP_DEPLOYMENT     – pause and wait for manual approval before shifting.
    action_on_timeout = "CONTINUE_DEPLOYMENT"
  }
}
```

### Traffic shifting strategy

The default deployment config uses `AllAtOnce` — 100 % of traffic is shifted in
a single step once the green target group is healthy. To use a slower canary
strategy, replace the `aws_codedeploy_deployment_config` resource in `main.tf`:

```hcl
traffic_routing_config {
  type = "TimeBasedCanary"
  time_based_canary {
    interval   = 5   # shift an additional percentage every N minutes
    percentage = 10  # start by shifting 10 % of traffic
  }
}
```

---

## Triggering a Blue/Green Deployment

The canonical way to deploy is by updating the ECS task definition (e.g., a new
image tag in `container_definitions`) and running Terraform. Terraform registers
the new task definition revision, then CodeDeploy orchestrates the shift.

### Via Terraform (recommended)

```bash
# Select the production workspace
terraform -chdir=deployment/terraform workspace select production

# Plan the change (review what will be updated)
terraform -chdir=deployment/terraform plan -var-file=production.tfvars

# Apply — registers new task definition; CodeDeploy handles the traffic shift
terraform -chdir=deployment/terraform apply -var-file=production.tfvars
```

> **Note:** `aws_ecs_service.main` has `lifecycle.ignore_changes` on
> `task_definition` and `load_balancer` so that Terraform does not fight with
> CodeDeploy over those attributes between deployments.

### Via AWS CLI

```bash
# 1. Look up the latest registered task definition for the service
TASK_DEF_ARN=$(aws ecs describe-task-definition \
  --task-definition stellar-portfolio-production-app \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)

# 2. Create the deployment
aws deploy create-deployment \
  --application-name stellar-portfolio-production-ecs-app \
  --deployment-group-name stellar-portfolio-production-deployment-group \
  --deployment-config-name stellar-portfolio-production-ecs-deployment-config \
  --description "Deploy $(date -u +%Y-%m-%dT%H:%MZ)" \
  --revision '{
    "revisionType": "AppSpecContent",
    "appSpecContent": {
      "content": "{\"version\":0.0,\"Resources\":[{\"TargetService\":{\"Type\":\"AWS::ECS::Service\",\"Properties\":{\"TaskDefinition\":\"'"$TASK_DEF_ARN"'\",\"LoadBalancerInfo\":{\"ContainerName\":\"backend\",\"ContainerPort\":3000}}}}]}"
    }
  }'
```

### Via AWS Console

1. Open **CodeDeploy → Applications → `stellar-portfolio-production-ecs-app`**.
2. Select **`stellar-portfolio-production-deployment-group`**.
3. Click **Create deployment**.
4. Set **Revision type** to `AppSpec content` and provide the task definition ARN.
5. Review the settings and click **Deploy**.

---

## Monitoring a Deployment

### Deployment lifecycle events

Each CodeDeploy deployment moves through these lifecycle events:

```
BeforeInstall  →  Install  →  AfterInstall
→  AllowTestTraffic  (test listener 8080 active — health checks run here)
→  AfterAllowTestTraffic
→  BeforeAllowTraffic
→  AllowTraffic  (production listener 80 shifted to green)
→  AfterAllowTraffic
```

A failure at **AllowTestTraffic** (health checks not passing) triggers an
automatic rollback before any production traffic is affected.

### Via AWS CLI

```bash
# List recent deployments for the group
aws deploy list-deployments \
  --application-name stellar-portfolio-production-ecs-app \
  --deployment-group-name stellar-portfolio-production-deployment-group \
  --query 'deployments' \
  --output table

# Get detailed status of a specific deployment
aws deploy get-deployment \
  --deployment-id d-XXXXXXXXX \
  --query 'deploymentInfo.{Status:status,CreateTime:createTime,Overview:deploymentOverview}'

# Describe lifecycle events (equivalent to the Console's event timeline)
aws deploy get-deployment-instance \
  --deployment-id d-XXXXXXXXX \
  --instance-id i-XXXXXXXXX
```

### Via AWS Console

- **CodeDeploy → Deployments** — live event timeline with pass/fail per step.
- **EC2 → Target Groups → `<prefix>-tg-green`** — healthy host count graph.
- **CloudWatch → Alarms → `<prefix>-deployment-alarm`** — healthy host alarm.

### CloudWatch metrics to watch during a deployment

| Metric | Namespace | Dimension | What to look for |
|---|---|---|---|
| `HealthyHostCount` | `AWS/ApplicationELB` | TG + ALB | Must stay ≥ 1 throughout |
| `UnHealthyHostCount` | `AWS/ApplicationELB` | TG + ALB | Must stay 0 after shift |
| `CPUUtilization` | `AWS/ECS` | Cluster + Service | Should not spike above baseline |
| `MemoryUtilization` | `AWS/ECS` | Cluster + Service | Should not spike above baseline |
| `HTTPCode_Target_5XX_Count` | `AWS/ApplicationELB` | TG | Must stay 0 after shift |

### SNS notifications

All deployment events (success, failure, rollback) are published to:

```
<prefix>-deployment-notifications
```

Subscribe an email address, Slack (via AWS Chatbot), or PagerDuty endpoint to
receive real-time alerts.

```bash
# Subscribe an email address
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:123456789012:stellar-portfolio-production-deployment-notifications \
  --protocol email \
  --notification-endpoint ops-team@example.com
```

---

## Rollback

### Automatic rollback

Rollback is triggered automatically when:

| Condition | Config |
|---|---|
| Health checks fail (target group unhealthy) | `auto_rollback_configuration.events = ["DEPLOYMENT_FAILURE"]` |
| `<prefix>-deployment-alarm` fires (HealthyHostCount < 1) | `auto_rollback_configuration.events = ["DEPLOYMENT_STOP_ON_ALARM"]` |

When rollback fires, CodeDeploy shifts the production listener back to the
**blue** target group — all traffic returns to the previous version within
seconds.

### Manual rollback

```bash
# Option 1 – Stop the in-progress deployment (reverts to blue automatically)
aws deploy stop-deployment \
  --deployment-id d-XXXXXXXXX \
  --auto-rollback-enabled

# Option 2 – Create a new deployment targeting the previous task definition
PREV_TASK_DEF_ARN="arn:aws:ecs:us-east-1:123456789012:task-definition/stellar-portfolio-production-app:N"

aws deploy create-deployment \
  --application-name stellar-portfolio-production-ecs-app \
  --deployment-group-name stellar-portfolio-production-deployment-group \
  --deployment-config-name stellar-portfolio-production-ecs-deployment-config \
  --description "Rollback to revision N" \
  --revision '{
    "revisionType": "AppSpecContent",
    "appSpecContent": {
      "content": "{\"version\":0.0,\"Resources\":[{\"TargetService\":{\"Type\":\"AWS::ECS::Service\",\"Properties\":{\"TaskDefinition\":\"'"$PREV_TASK_DEF_ARN"'\",\"LoadBalancerInfo\":{\"ContainerName\":\"backend\",\"ContainerPort\":3000}}}}]}"
    }
  }'
```

---

## Troubleshooting

### Deployment stuck at `AllowTestTraffic`

The green target group is not passing health checks. Check:

1. Container logs in CloudWatch: `/ecs/<prefix>-backend`
2. Target group health in the Console: **EC2 → Target Groups → `<prefix>-tg-green`**
3. `/api/v1/health` endpoint returns HTTP 200 inside the green task
4. Security groups allow traffic from the ALB on port 3000

```bash
# Fetch the last 100 lines of the backend log stream
aws logs get-log-events \
  --log-group-name /ecs/stellar-portfolio-production-backend \
  --log-stream-name ecs/backend/<task-id> \
  --limit 100
```

### `deployment_controller` conflict

If you see an error like `DeploymentController cannot be updated`, the ECS
service was originally created with `ECS` controller and must be **destroyed and
recreated** to switch to `CODE_DEPLOY`. This is a one-time migration:

```bash
terraform -chdir=deployment/terraform destroy \
  -target=module.ecs.aws_ecs_service.main \
  -var-file=production.tfvars

terraform -chdir=deployment/terraform apply \
  -var-file=production.tfvars
```

### Alarm not triggering rollback

Verify the alarm name in CodeDeploy matches exactly:

```bash
aws deploy get-deployment-group \
  --application-name stellar-portfolio-production-ecs-app \
  --deployment-group-name stellar-portfolio-production-deployment-group \
  --query 'deploymentGroupInfo.alarmConfiguration'
```

The alarm name should be `stellar-portfolio-production-deployment-alarm`.

---

## Cost Considerations

During a deployment, both blue and green task sets run simultaneously. The
`termination_wait_time_in_minutes` (default: 30 min) controls how long blue
tasks remain running after a successful shift.

- Shorter window → lower cost; shorter manual rollback window.
- For staging, blue/green is disabled (`enable_blue_green = false`) — rolling
  updates are used to keep costs down.

---

## Best Practices

1. **Always deploy staging first.** The `staging` workspace uses rolling updates
   so issues surface cheaply before hitting production.
2. **Watch the deployment in real time.** Open the CodeDeploy console or poll
   `aws deploy get-deployment` until the status is `Succeeded` or `Failed`.
3. **Never force-stop an in-progress deployment** unless you intend to roll back.
   Use `--auto-rollback-enabled` with `stop-deployment` to be safe.
4. **Pin image tags.** Use a specific Git SHA tag (e.g., `:sha-abc1234`) rather
   than `:latest` so every deployment is reproducible and rollbacks are
   unambiguous.
5. **Subscribe to the SNS topic.** Route notifications to Slack or PagerDuty
   so the team is alerted immediately on failure or rollback.
