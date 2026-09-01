variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "stellar-portfolio"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = map(string)
  default = {
    staging    = "db.t4g.micro"
    production = "db.t4g.small"
  }
}

variable "backup_retention_period" {
  description = "Days of RDS automated backups + snapshot retention, per workspace"
  type        = map(number)
  default = {
    staging    = 7
    production = 14
  }
}

variable "secret_rotation_days" {
  description = "Days between automatic secret rotations"
  type        = number
  default     = 30
}

variable "secret_rotation_lambda_arn" {
  description = "ARN of the Lambda that rotates DB/Redis secrets (optional; null = AWS managed rotation)"
  type        = string
  default     = null
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = map(string)
  default = {
    staging    = "cache.t4g.micro"
    production = "cache.t4g.small"
  }
}

variable "secret_rotation_days" {
  description = "Days between automatic secret rotations"
  type        = number
  default     = 30
}

variable "secret_rotation_lambda_arn" {
  description = "ARN of the Lambda that rotates DB/Redis secrets (optional; null = AWS managed rotation)"
  type        = string
  default     = null
}

variable "snapshot_cleanup_schedule" {
  description = "EventBridge schedule for the RDS snapshot cleanup Lambda"
  type        = string
  default     = "cron(0 21 * * ? *)"
}

variable "ecs_task_cpu" {
  description = "ECS Task CPU"
  type        = map(number)
  default = {
    staging    = 256
    production = 512
  }
}

variable "ecs_task_memory" {
  description = "ECS Task Memory"
  type        = map(number)
  default = {
    staging    = 512
    production = 1024
  }
}

variable "monthly_cost_limit" {
  description = "Monthly cost limit in USD per workspace"
  type        = map(number)
  default = {
    staging    = 50.0
    production = 200.0
  }
}

variable "budget_notification_emails" {
  description = "Email addresses for budget notifications"
  type        = list(string)
  default     = []
}

variable "budget_notification_sns_topics" {
  description = "SNS topic ARNs for budget notifications"
  type        = list(string)
  default     = []
}

variable "create_budget_sns_topic" {
  description = "Create an SNS topic for budget alerts"
  type        = bool
  default     = true
}

variable "enable_service_budgets" {
  description = "Enable service-specific usage budgets"
  type        = bool
  default     = false
}

variable "ec2_usage_limit" {
  description = "EC2/compute usage limit in GB-Hours"
  type        = number
  default     = 1000.0
}

variable "enable_cost_anomaly_detection" {
  description = "Enable CloudWatch anomaly detection for daily spend"
  type        = bool
  default     = false
}

variable "daily_spend_threshold" {
  description = "Daily spend threshold in USD for anomaly detection"
  type        = number
  default     = 10.0
}

variable "enable_blue_green" {
  description = "Enable blue/green deployment for ECS"
  type        = map(bool)
  default = {
    staging    = false
    production = true
  }
}

# ─── Secret Rotation ──────────────────────────────────────────────────────────

variable "secret_rotation_days" {
  description = "Number of days between automatic AWS Secrets Manager rotations for RDS and Redis credentials. Applies to both modules."
  type        = number
  default     = 30

  validation {
    condition     = var.secret_rotation_days >= 1 && var.secret_rotation_days <= 365
    error_message = "secret_rotation_days must be between 1 and 365."
  }
}

variable "secret_rotation_lambda_arn" {
  description = <<-EOT
    ARN of an existing Lambda function used to rotate secrets.
    When null (the default), automatic rotation is disabled and the
    aws_secretsmanager_secret_rotation resources are not created.
    Provide the ARN of the AWS-managed rotation Lambda deployed in your
    account, e.g. the SecretsManagerRDSPostgreSQLRotationSingleUser Lambda,
    or your own custom rotation function.
  EOT
  type        = string
  default     = null
}

variable "create_rotation_lambda" {
  description = <<-EOT
    When true, deploys the rotation_lambda Terraform module which provisions
    the AWS Secrets Manager managed rotation Lambda for RDS PostgreSQL
    (single-user strategy) and a custom rotation Lambda for the Redis AUTH
    token.  Set to false (the default) when you prefer to supply an existing
    rotation Lambda via secret_rotation_lambda_arn.
  EOT
  type        = bool
  default     = false
}

variable "blue_green_deployment_config" {
  description = "Blue/green deployment configuration"
  type = object({
    termination_wait_time_in_minutes = optional(number, 30)
    deployment_ready_option = optional(object({
      action_on_timeout = optional(string, "CONTINUE_DEPLOYMENT")
    }), {})
  })
  default = {
    termination_wait_time_in_minutes = 30
    deployment_ready_option = {
      action_on_timeout = "CONTINUE_DEPLOYMENT"
    }
  }
}
variable "ecs_min_capacity" {
  description = "Minimum number of ECS tasks"
  type        = map(number)
  default = {
    staging    = 1
    production = 2
  }
}

variable "ecs_max_capacity" {
  description = "Maximum number of ECS tasks"
  type        = map(number)
  default = {
    staging    = 3
    production = 10
  }
}
