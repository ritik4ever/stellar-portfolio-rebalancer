output "sns_topic_arn" {
  description = "ARN of the SNS topic for budget alerts"
  value       = try(aws_sns_topic.budget_alerts[0].arn, null)
}

output "monthly_budget_arn" {
  description = "ARN of the monthly cost budget"
  value       = aws_budgets_budget.monthly_cost.arn
}

output "ec2_budget_arn" {
  description = "ARN of the EC2 usage budget (if enabled)"
  value       = try(aws_budgets_budget.ec2_usage[0].arn, null)
}
