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
