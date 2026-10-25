output "rollout_outcome" {
  description = "Result signal for the Terraform rollout: success, transient_delay, or blocked."
  value       = local.rollout_result.status
}

output "rollout_affected_service" {
  description = "Service affected by a partial apply, if any. Null on a clean success."
  value       = local.rollout_result.service
}

output "rollout_owner_action" {
  description = "Owner action required to resolve a transient delay or blocked rollout. Null on a clean success."
  value       = local.rollout_result.owner_action
}

output "budget_name" {
  description = "Name of the monthly budget resource."
  value       = aws_budgets_budget.monthly.id
}

output "budget_sns_topic_arn" {
  description = "ARN of the SNS topic receiving budget alerts."
  value       = aws_sns_topic.budget_alerts.arn
}
