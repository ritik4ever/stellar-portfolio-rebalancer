# Staging workspace configuration
# Usage: terraform apply -var-file=staging.tfvars --workspace=staging

aws_region = "us-east-1"
project_name = "stellar-portfolio"
vpc_cidr = "10.1.0.0/16"

# Staging uses smaller, cheaper instance types
db_instance_class = {
  staging = "db.t4g.micro"
}

redis_node_type = {
  staging = "cache.t4g.micro"
}

ecs_task_cpu = {
  staging = 256
}

ecs_task_memory = {
  staging = 512
}

# Budget configuration for staging
monthly_cost_limit = {
  staging = 50.0
}

budget_notification_emails = ["team@example.com"]
create_budget_sns_topic = true
enable_service_budgets = false
enable_cost_anomaly_detection = false

# Blue/Green deployment configuration
enable_blue_green = {
  staging = false
}
