resource "aws_sns_topic" "budget_alerts" {
  tags = {
    CostCenter = "platform"
  }
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.budget_alerts.arn
  protocol = "email"
  endpoint = "foo@example.com"
}

resource "aws_budgets_budget" "monthly" {
  budget_type = "COST"
  limit_amount = "1000"
  limit_unit = "USD"
  time_unit = "MONTHLY"
  time_period_start = "2024-01-01"

  notification {
    comparison_operator = "GREATER_THAN"
    threshold = 80
    threshold_type = "PERCENTAGE"
    notification_type = "ACTUAL"
    subscriber_sns_topic_arns = [aws_sns_topic.budget_alerts.arn]
  }

  tags = {
    CostCenter = "platform"
  }
}

output "budget_name" {
  value = aws_budgets_budget.monthly.id
}

output "budget_sns_topic_arn" {
  value = aws_sns_topic.budget_alerts.arn
}

# Report the rollout outcome for the Terraform apply so downstream
	# automation can distinguish success, a transient delay, and blocked work.
	# Success: apply completed with no pending or errored changes.
	# Transient delay: apply is still in progress or a single service change
	# is waiting on a retry-able condition.
	# Blocked: apply failed or a service change is blocked and requires owner action.

variable "rollout_outcome" {
  description = "Overall Terraform rollout outcome for the rebalancing workflow. One of: success, transient_delay, blocked."
  type = string
  default = "success"

  validation {
    condition = contains(["success", "transient_delay", "blocked"], var.rollout_outcome)
    error_message = "rollout_outcome must be one of: success, transient_delay, blocked."
  }
}

variable "rollout_affected_service" {
  description = "Name of the service affected by a partial apply, if any."
  type = string
  default = null
}

variable "rollout_owner_action" {
  description = "Owner action required to resolve a blocked or delayed rollout, if any."
  type = string
  default = null
}

output "rollout_outcome" {
  description = "Overall rollout outcome: success, transient_delay, or blocked."
  value = var.rollout_outcome
}

output "rollout_affected_service" {
  description = "Service affected by a partial apply, if any."
  value = var.rollout_outcome == "success" ? null : var.rollout_affected_service
}

output "rollout_owner_action" {
  description = "Owner action required for a delayed or blocked rollout, if any."
  value = var.rollout_outcome == "success" ? null : var.rollout_owner_action
}
