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

## Modules

- `vpc`: VPC and networking configuration
- `rds`: PostgreSQL database
- `elasticache`: Redis cache
- `ecs`: ECS service with Fargate
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
