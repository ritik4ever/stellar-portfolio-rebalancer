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

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = map(string)
  default = {
    staging    = "cache.t4g.micro"
    production = "cache.t4g.small"
  }
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
