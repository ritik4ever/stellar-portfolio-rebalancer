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

variable "rollout_outcome_signal" {
  description = "Reported outcome of a Terraform rollout: 'success', 'transient_delay', or 'blocked'. Set by the rollout workflow to distinguish outcomes for a partial apply affecting a single service."
  type        = string
  default     = "success"

  validation {
    condition     = contains(["success", "transient_delay", "blocked"], var.rollout_outcome_signal)
    error_message = "rollout_outcome_signal must be one of: success, transient_delay, blocked."
  }
}

variable "rollout_affected_service" {
  description = "Name of the service affected by a partial Terraform apply during rollout. Empty when the rollout is not partial."
  type        = string
  default     = ""
}

variable "rollout_owner_action" {
  description = "Owner action required to resolve a partial Terraform apply affecting a single service (e.g., 'retry_apply', 'review_plan_and_apply', 'resolve_blocker'). Empty when no action is required."
  type        = string
  default     = ""
}
