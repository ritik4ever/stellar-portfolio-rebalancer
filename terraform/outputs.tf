output "budget_name" {
  description = "Name of the AWS Budget"
  value       = aws_budgets_budget.monthly.id
}

output "budget_sns_topic_arn" {
  description = "ARN of the AWS SNS topic for budget alerts"
  value       = aws_sns_topic.budget_alerts.arn
}
