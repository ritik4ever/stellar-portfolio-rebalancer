# Production workspace configuration
# Usage: terraform apply -var-file=production.tfvars --workspace=production

aws_region   = "us-east-1"
project_name = "stellar-portfolio"
vpc_cidr     = "10.0.0.0/16"

# Production uses larger instance types for performance
db_instance_class = {
  production = "db.t4g.small"
}

redis_node_type = {
  production = "cache.t4g.small"
}

ecs_task_cpu = {
  production = 512
}

ecs_task_memory = {
  production = 1024
}

# Budget configuration for production
monthly_cost_limit = {
  production = 200.0
}

budget_notification_emails     = ["team@example.com", "finance@example.com"]
budget_notification_sns_topics = ["arn:aws:sns:us-east-1:123456789012:slack-alerts"]
create_budget_sns_topic        = true
enable_service_budgets         = true
ec2_usage_limit                = 2000.0
enable_cost_anomaly_detection  = true
daily_spend_threshold          = 20.0

# Blue/Green deployment configuration
enable_blue_green = {
  production = true
}

# ─── Credential Rotation ──────────────────────────────────────────────────────
# Rotate secrets every 14 days in production for tighter security posture.
# Set create_rotation_lambda = true to auto-deploy the rotation Lambdas
# via this Terraform workspace.  Alternatively, set it to false and supply
# the ARN of a pre-existing rotation Lambda below.
secret_rotation_days       = 14
create_rotation_lambda     = false
# secret_rotation_lambda_arn = "arn:aws:lambda:us-east-1:123456789012:function:prod-rds-rotation"
