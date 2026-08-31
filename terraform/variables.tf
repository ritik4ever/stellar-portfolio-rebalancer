variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment (e.g., dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "project" {
  description = "Project name used for tagging and resource naming"
  type        = string
  default     = "stellar-portfolio-rebalancer"
}

variable "budget_limit" {
  description = "Monthly budget limit in USD"
  type        = number
  default     = 100
}

variable "budget_thresholds" {
  description = "List of budget thresholds as fractions (e.g., 0.5 for 50%)"
  type        = list(number)
  default     = [0.5, 0.8, 0.9]
}

variable "notification_email" {
  description = "List of email addresses for budget alerts"
  type        = list(string)
  default     = []
}

variable "notification_slack_webhook" {
  description = "Slack webhook URL for budget alerts"
  type        = string
  default     = ""
}
