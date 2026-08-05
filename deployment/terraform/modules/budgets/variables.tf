variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "project_tag" {
  description = "Project tag value for cost allocation"
  type        = string
  default     = "StellarPortfolioRebalancer"
}

variable "environment_tag" {
  description = "Environment tag value"
  type        = string
}

variable "monthly_cost_limit" {
  description = "Monthly cost limit in USD"
  type        = number
  default     = 100.0
}

variable "notification_emails" {
  description = "List of email addresses for budget notifications"
  type        = list(string)
  default     = []
}

variable "notification_sns_topics" {
  description = "List of SNS topic ARNs for budget notifications"
  type        = list(string)
  default     = []
}

variable "create_sns_topic" {
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

variable "enable_anomaly_detection" {
  description = "Enable CloudWatch anomaly detection for daily spend"
  type        = bool
  default     = false
}

variable "daily_spend_threshold" {
  description = "Daily spend threshold in USD for anomaly detection"
  type        = number
  default     = 10.0
}
