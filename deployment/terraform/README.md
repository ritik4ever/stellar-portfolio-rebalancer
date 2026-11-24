# Terraform Infrastructure

This directory contains the Terraform configuration for deploying the Stellar Portfolio Rebalancer infrastructure.

## Workspaces

This project uses Terraform workspaces to isolate staging and production environments:

- **staging**: Reduced-scale environment for testing and validation
- **production**: Full-scale production environment

## State Management

State is stored in S3 with DynamoDB locking for state consistency. Each workspace has its own isolated state file:
- `s3://stellar-portfolio-tf-state/staging/terraform.tfstate`
- `s3://stellar-portfolio-tf-state/production/terraform.tfstate`

## Prerequisites

1. AWS credentials configured with appropriate permissions
2. S3 bucket `stellar-portfolio-tf-state` created
3. DynamoDB table `stellar-portfolio-tf-locks` created for state locking

## Initial Setup

```bash
# Initialize Terraform with the staging workspace
terraform init
terraform workspace new staging
terraform apply -var-file=staging.tfvars

# Switch to production workspace
terraform workspace new production
terraform apply -var-file=production.tfvars
```

## Deployment

### Staging

Staging deploys automatically on push to the `staging` branch via GitHub Actions.

Manual deployment:
```bash
terraform workspace select staging
terraform plan -var-file=staging.tfvars
terraform apply -var-file=staging.tfvars
```

### Production

Production requires manual approval. To promote changes from staging to production:

1. Verify staging environment is working correctly
2. Merge the feature branch to `main`
3. Run the production deployment workflow with manual approval
4. Monitor the deployment for any issues

Manual deployment:
```bash
terraform workspace select production
terraform plan -var-file=production.tfvars
terraform apply -var-file=production.tfvars
```

## Promoting Staging to Production

To promote verified changes from staging to production:

1. **Validate Staging**: Ensure all tests pass and the staging environment is stable
2. **Create PR**: Create a pull request from `staging` to `main`
3. **Code Review**: Get approval from at least one maintainer
4. **Merge**: Merge the PR to `main`
5. **Deploy**: The production deployment workflow will trigger automatically
6. **Monitor**: Watch the deployment logs and health checks

## Cost Optimization

Staging uses smaller instance types to reduce costs:
- RDS: `db.t4g.micro` (staging) vs `db.t4g.small` (production)
- ElastiCache: `cache.t4g.micro` (staging) vs `cache.t4g.small` (production)
- ECS: 256 CPU / 512MB memory (staging) vs 512 CPU / 1024MB memory (production)

## Destroying Environments

To destroy an environment (use with caution):

```bash
# Destroy staging
terraform workspace select staging
terraform destroy -var-file=staging.tfvars

# Destroy production (requires careful verification)
terraform workspace select production
terraform destroy -var-file=production.tfvars
```

## Redis High Availability (ElastiCache)

The `elasticache` module provisions Redis as a **Multi-AZ replication group with automatic failover** and at least one read replica in a **different availability zone** from the primary:

| Setting | Value |
| --- | --- |
| `multi_az_enabled` | `true` (default) |
| `automatic_failover_enabled` | `true` (default) |
| `replica_count` | `1` staging / `2` production (minimum `1`) |
| `availability_zones` | `var.azs` — the same AZs the VPC subnets use |

If the primary node fails, ElastiCache promotes the available replica with the least replication lag (in the same or another AZ) and repoints the replication-group endpoint at it; if the primary's whole AZ fails, the promoted replica is necessarily in a surviving AZ. The endpoint name never changes, so the backend only needs to reconnect — no Terraform or application change.

Per-workspace knobs in the tfvars files:

```hcl
redis_multi_az_enabled           = true   # Multi-AZ + automatic failover
redis_automatic_failover_enabled = true
redis_replica_count = {
  staging    = 1
  production = 2
}
azs = ["us-east-1a", "us-east-1b"]
```

Full detail — including what clients observe during a switchover and how to run a failover drill — is in [`modules/elasticache/README.md`](modules/elasticache/README.md).

## Recovering a worker after secret rotation

The deployment smoke check compares the active, previous, and notification-worker
credentials without printing their values:

```bash
node deployment/rotation-smoke.mjs
```

Provide `ROTATION_ACTIVE_KEY` and `ROTATION_WORKER_KEY`, and optionally
`ROTATION_PREVIOUS_KEY` and `ROTATION_ACTIVE_VERSION`, from an approved secure
environment. Do not put credential literals in shell history, CI output, or
incident tickets. A `stale-worker` result exits with code `1`, reports only
short SHA-256 fingerprints, and recommends restarting the worker. Exit code `2`
means the check inputs are invalid; resolve that before taking recovery action.

A credential refresh updates the backend's credential cache, but it does not
replace the Redis connection already held by a running BullMQ worker. Restart
the ECS service so a new task loads the current Secrets Manager version and
creates fresh worker connections:

1. Select the affected Terraform workspace and capture the current service
   deployment state before changing anything:
   ```bash
   terraform -chdir=deployment/terraform workspace select <environment>
   CLUSTER=$(terraform -chdir=deployment/terraform output -raw ecs_cluster_name)
   SERVICE=$(terraform -chdir=deployment/terraform output -raw ecs_service_name)
   TASK_DEF_ARN=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
     --query 'services[0].taskDefinition' --output text)
   aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
     --query 'services[0].{controller:deploymentController.type,taskDefinition:taskDefinition,desired:desiredCount,running:runningCount}'
   ```
2. Confirm the rotated secret is `AWSCURRENT` and the Redis replication group
   is `available` before restarting the worker. Do not retrieve or print the
   secret value:
   ```bash
   SECRET_ARN=$(terraform -chdir=deployment/terraform output -raw redis_secret_arn)
   aws secretsmanager describe-secret --secret-id "$SECRET_ARN" \
     --query 'VersionIdsToStages'
   REDIS_GROUP=$(terraform -chdir=deployment/terraform output -raw redis_replication_group_id)
   aws elasticache describe-replication-groups --replication-group-id "$REDIS_GROUP" \
     --query 'ReplicationGroups[0].Status'
   ```
3. Restart according to the service deployment controller:
   - For the `ECS` controller (staging), run
     `aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --force-new-deployment`
     and wait with `aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE"`.
   - For the `CODE_DEPLOY` controller (production), start a CodeDeploy
     deployment using `$TASK_DEF_ARN` (the currently serving revision), with
     the procedure in [`BLUE_GREEN_DEPLOYMENTS.md`](BLUE_GREEN_DEPLOYMENTS.md#via-aws-cli).
     Do not substitute the latest registered task revision for this
     credential-only restart. This preserves the blue/green traffic-shift and
     automatic-rollback behavior.
4. Verify the ECS service is stable with `runningCount == desiredCount`,
   `curl -fsS "http://$(terraform -chdir=deployment/terraform output -raw backend_url)/api/v1/health"`
   returns HTTP 200, `/api/ops/queue/health` reports `redisConnected: true`,
   and `/api/ops/workers/health` lists the notification worker as
   ready/healthy. Re-run the smoke check using the replacement worker's
   credential source; require `status: "ok"` (exit code `0`) before closing
   the incident.

**Rollback boundary:** If the replacement task or worker does not become
healthy, stop further deployments and use the ECS deployment circuit breaker
or CodeDeploy automatic rollback to return traffic to the last healthy task
revision. This rollback affects the compute revision only; it does not undo a
Secrets Manager rotation or restore a previous Redis AUTH token. Do not move
`AWSCURRENT` backwards or reapply an old AUTH token as part of an ECS rollback.
Keep the failed rotation state intact and resolve it with the secret-rotation
owner before attempting another rotation. Pending queue jobs remain in Redis;
do not purge or replay them as a credential-recovery step.

## Rollout Recovery from a Partial Apply

A Terraform apply is not atomic. When a plan applies some resources and then errors on others,
the rollout recovery signal lets the CI post-apply step decide whether to proceed, wait, or
halt and notify the owner.

### Signal values

| Signal | Meaning |
|---|---|
| `success` | Apply completed cleanly; all resources are in the desired state. |
| `transient_delay` | A retryable condition was encountered. Wait and re-run. |
| `blocked` | Apply failed; owner action is required before retrying. |

### Setting the signal (CI)

The CI wrapper that calls `terraform apply` passes the signal via a variable:

```bash
# Determine the signal from apply exit code and error output, then apply:
terraform apply \
  -var "rollout_outcome_signal=blocked" \
  -var "rollout_affected_service=ecs-service" \
  -var "rollout_owner_action=resolve_blocker" \
  tfplan
```

### Reading the signal (post-apply CI step)

```bash
STATUS=$(terraform output -raw rollout_outcome)

case "$STATUS" in
  success)
    echo "Rollout complete."
    ;;
  transient_delay)
    ACTION=$(terraform output -raw rollout_owner_action)
    echo "Waiting — $ACTION. Re-run terraform apply after the ECS deployment stabilizes."
    ;;
  blocked)
    ACTION=$(terraform output -raw rollout_owner_action)
    SERVICE=$(terraform output -raw rollout_affected_service)
    echo "::error::Rollout blocked on $SERVICE. Owner action: $ACTION"
    exit 1
    ;;
esac
```

### ECS-specific recovery outputs

When the affected service is the ECS service, additional outputs are available:

| Output | Description |
|---|---|
| `ecs_rollout_status` | ECS-scoped status token. |
| `ecs_rollout_cluster` | Cluster name, or `null` on success. |
| `ecs_rollout_affected_service` | ECS service name, or `null` on success (mirrored from ECS module). |
| `ecs_rollout_owner_action` | Remediation token, or `null` on success. |
| `ecs_rollout_detail` | Human-readable description of the ECS rollout outcome. |
| `ecs_rollout_target_address` | Terraform `-target` address for a scoped recovery apply, or `null` on success. |

### Safe rollback boundary for a partial apply affecting the ECS service

When `ecs_rollout_status` is `blocked`:

1. **Do NOT apply the full plan again** without resolving the owner action.
2. Run `terraform plan` to confirm drift is limited to the ECS service:
   ```bash
   terraform plan -var-file=<env>.tfvars
   ```
3. Resolve the prerequisite identified by `ecs_rollout_owner_action`.
4. Apply with a targeted plan scoped to the ECS service only:
   ```bash
   # The target address is available as a Terraform output:
   TARGET=$(terraform output -raw ecs_rollout_target_address)
   terraform apply -target="$TARGET" -var-file=<env>.tfvars
   ```
5. Verify the service reaches a healthy state:
   - ECS service `runningCount == desiredCount`
   - ALB target group healthy host count ≥ 1
   - `/api/v1/health` returns HTTP 200
6. Re-run the full apply once the targeted apply succeeds and `ecs_rollout_status` returns `success`.

If the targeted apply also fails, roll back to the previous task definition revision:

```bash
aws ecs update-service \
  --cluster <cluster-name> \
  --service <service-name> \
  --task-definition <previous-task-def-arn> \
  --force-new-deployment
```

This restores the ECS service without touching any other resource and provides a clear
rollback boundary: only the ECS service is in a non-desired state; all other resources
remain unaffected.

See `modules/ecs/rollout_recovery.tf` for the full in-code procedure and the
`tests/ecs_rollout_recovery.tftest.hcl` test suite.

### Validating Terraform Rollout from a Clean Environment (SPR-2026-271)

To validate state consistency, plan reproducibility, and safe rollback boundaries without relying on undocumented local state:

1. **Clean checkout verification**:
   No local `.tfstate` files or undocumented machine variables are required. Remote state backend configuration in `providers.tf` is fully declared with S3 and DynamoDB locking.
   ```bash
   cd deployment/terraform
   terraform init -input=false
   terraform validate
   ```

2. **Reproducing a plan with no infrastructure changes**:
   Select the target workspace and execute a detailed plan check:
   ```bash
   terraform workspace select staging
   terraform plan -detailed-exitcode -var-file=staging.tfvars -no-color
   ```
   Exit code 0 confirms exact state consistency and zero infrastructure drift between the repository and AWS.

3. **Isolated service execution**:
   To test or roll out an isolated service (e.g. ECS service only):
   ```bash
   terraform plan -target=module.ecs.aws_ecs_service.main -var-file=staging.tfvars
   ```

4. **Rollback steps without undocumented local state**:
   If an apply is interrupted or results in `ecs_rollout_status == "blocked"`, execute the targeted rollback command or re-run with the previous task revision ARN from state outputs. Never delete or bypass remote state locks.


## Modules

- `vpc`: VPC and networking configuration
- `rds`: PostgreSQL database
- `elasticache`: Redis cache
- `ecs`: ECS service with Fargate (includes rollout recovery signal)
- `s3_cloudfront`: S3 bucket with CloudFront CDN
- `budgets`: AWS Budgets and cost monitoring with alerting

## Cost Monitoring and Budgets

The infrastructure includes AWS Budgets for cost monitoring and alerting:

### Budget Thresholds

- **Staging**: $50/month
- **Production**: $200/month

### Alert Notifications

Alerts are triggered at the following thresholds:
- 50% of budget - Email notification
- 75% of budget - Email notification
- 90% of budget - Email + SNS notification
- 100% of budget - Email + SNS notification (critical)
- 80% forecasted - Email + SNS notification

### Configuration

Budget notifications are configured via terraform variables:
- `budget_notification_emails`: List of email addresses for alerts
- `budget_notification_sns_topics`: List of SNS topic ARNs for Slack/other integrations
- `enable_cost_anomaly_detection`: Enable CloudWatch anomaly detection for daily spend

### Escalation Contacts

Update the notification emails in the respective tfvars files:
- `staging.tfvars`: Staging budget contacts
- `production.tfvars`: Production budget contacts (includes finance team)
