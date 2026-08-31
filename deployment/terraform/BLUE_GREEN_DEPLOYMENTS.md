# Blue/Green Deployment Guide

This guide explains how to use blue/green deployments for the backend ECS service.

## Overview

Blue/green deployments provide zero-downtime deployments by:
1. Deploying the new version to a separate (green) target group
2. Running health checks against the green environment
3. Shifting traffic from blue (current) to green (new) gradually
4. Automatically rolling back if health checks fail

## Configuration

Blue/green deployments are enabled per workspace:
- **Staging**: Disabled (uses rolling updates for faster iteration)
- **Production**: Enabled (for zero-downtime deployments)

Configuration is set in the respective tfvars files:
- `staging.tfvars`: `enable_blue_green = { staging = false }`
- `production.tfvars`: `enable_blue_green = { production = true }`

## Deployment Configuration

The blue/green deployment is configured with the following settings:

### Traffic Shifting
- **Deployment Config**: `CodeDeployDefault.ECSAllAtOnce` (shifts all traffic at once after health checks pass)
- **Termination Wait Time**: 30 minutes (keeps blue tasks running for rollback)
- **Deployment Ready Option**: `CONTINUE_DEPLOYMENT` (proceeds if health checks timeout)

### Health Checks
- **Health Check Path**: `/api/v1/health`
- **Healthy Threshold**: 3 consecutive successful checks
- **Unhealthy Threshold**: 2 consecutive failed checks
- **Interval**: 30 seconds
- **Timeout**: 3 seconds

### Automatic Rollback
- **Circuit Breaker**: Enabled (rolls back on deployment failure)
- **Rollback Events**: `DEPLOYMENT_FAILURE`
- **CloudWatch Alarm**: Monitors healthy host count (< 1 triggers rollback)

## Triggering a Blue/Green Deployment

### Via AWS Console

1. Navigate to the CodeDeploy console
2. Select the application: `stellar-portfolio-production-ecs-deployment`
3. Select the deployment group: `stellar-portfolio-production-deployment-group`
4. Click "Create deployment"
5. Select the new task definition revision
6. Review and deploy

### Via AWS CLI

```bash
# Get the latest task definition ARN
TASK_DEF_ARN=$(aws ecs list-task-definitions \
  --family stellar-portfolio-production-app \
  --sort DESC \
  --max-items 1 \
  --query 'taskDefinitionArns[0]' \
  --output text)

# Create a deployment
aws deploy create-deployment \
  --application-name stellar-portfolio-production-ecs-deployment \
  --deployment-group-name stellar-portfolio-production-deployment-group \
  --deployment-config-name CodeDeployDefault.ECSAllAtOnce \
  --revision '{"revisionType": "ECS", "ecsTargetContent": {"targetGroups": [{"targetGroupArn": "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/stellar-portfolio-production-tg-blue/1234567890"}], "taskDefinition": "'$TASK_DEF_ARN'"}}'
```

### Via Terraform

When you update the ECS task definition (e.g., by changing the Docker image tag), Terraform will automatically trigger a new deployment:

```bash
terraform apply -var-file=production.tfvars
```

## Monitoring Deployments

### Via AWS Console

1. Navigate to the CodeDeploy console
2. Select the deployment
3. View the deployment lifecycle events
4. Check traffic shifting progress

### Via AWS CLI

```bash
# List recent deployments
aws deploy list-deployments \
  --application-name stellar-portfolio-production-ecs-deployment \
  --deployment-group-name stellar-portfolio-production-deployment-group

# Get deployment status
aws deploy get-deployment \
  --deployment-id <deployment-id>

# View deployment events
aws deploy list-deployment-instances \
  --deployment-id <deployment-id>

aws deploy get-deployment-instance \
  --deployment-id <deployment-id> \
  --instance-id <instance-id>
```

### CloudWatch Metrics

Monitor the following CloudWatch metrics during deployment:
- `ECS/Deployment`: Deployment percent, Rollback percent
- `AWS/ElasticLoadBalancing`: HealthyHostCount, UnHealthyHostCount
- `AWS/ECS`: CPUUtilization, MemoryUtilization

## Notifications

Deployment notifications are sent via SNS:
- **Topic**: `stellar-portfolio-production-deployment-notifications`
- **Events**: `DeploymentSuccess`, `DeploymentFailure`
- **Subscribers**: Configure via SNS topic subscriptions

To add Slack notifications:
1. Create an SNS topic subscription to a Slack endpoint
2. Or use AWS Chatbot to integrate with Slack

## Rollback

### Automatic Rollback

Rollback is automatically triggered if:
- Health checks fail during deployment
- CloudWatch alarm triggers (healthy hosts < 1)
- Deployment circuit breaker detects failure

### Manual Rollback

```bash
# Stop the current deployment
aws deploy stop-deployment \
  --deployment-id <deployment-id>

# Create a rollback deployment
aws deploy create-deployment \
  --application-name stellar-portfolio-production-ecs-deployment \
  --deployment-group-name stellar-portfolio-production-deployment-group \
  --deployment-config-name CodeDeployDefault.ECSAllAtOnce \
  --revision '{"revisionType": "ECS", "ecsTargetContent": {"targetGroups": [{"targetGroupArn": "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/stellar-portfolio-production-tg-blue/1234567890"}], "taskDefinition": "<previous-task-definition-arn>"}}'
```

## Troubleshooting

### Deployment Stuck in Progress

1. Check CodeDeploy deployment events for errors
2. Verify ECS tasks are starting successfully
3. Check target group health checks
4. Review CloudWatch logs for application errors

### Health Check Failures

1. Verify the health check endpoint is accessible: `curl https://<alb-dns>/api/v1/health`
2. Check application logs for errors
3. Ensure security groups allow health check traffic
4. Verify task definition environment variables

### Rollback Not Working

1. Verify the previous task definition still exists
2. Check that blue target group is still receiving traffic
3. Review CodeDeploy service role permissions
4. Ensure circuit breaker is enabled

## Best Practices

1. **Test in Staging First**: Always validate deployments in staging before production
2. **Monitor Closely**: Watch deployment events and metrics during the deployment
3. **Have Rollback Plan**: Know how to quickly rollback if issues arise
4. **Use Feature Flags**: Consider using feature flags for gradual feature rollouts
5. **Document Changes**: Keep track of what changed in each deployment
6. **Schedule Wisely**: Deploy during low-traffic periods when possible

## Cost Considerations

Blue/green deployments temporarily run double the capacity (blue + green tasks). The `termination_wait_time_in_minutes` setting (default: 30) controls how long blue tasks remain running after successful deployment. Adjust this based on your risk tolerance and cost sensitivity.

For cost-sensitive environments:
- Reduce `termination_wait_time_in_minutes` to 5-10 minutes
- Monitor deployment duration closely
- Consider using rolling updates for non-critical deployments
