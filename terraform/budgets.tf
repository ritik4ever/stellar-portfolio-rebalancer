# Budget alerting for AWS costs
# Monthly budget per project and environment with notification thresholds.

resource "aws_budgets_budget" "monthly" {
  name         = "monthly-${var.project}-${var.environment}"
  budget_type  = "COST"
  limit_amount = var.budget_limit
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = [format("user:Project$%s", local.common_tags.Project)]
  }

  dynamic "notification" {
    for_each = var.budget_thresholds
    content {
      comparison_operator        = "GREATER_THAN"
      threshold_type             = "PERCENTAGE"
      threshold                  = floor(notification.value * 100)
      notification_type          = "ACTUAL"
      subscriber_sns_topic_arns = [aws_sns_topic.budget_alerts.arn]
    }
  }

  tags = local.common_tags
}

# SNS topic for budget alerts
resource "aws_sns_topic" "budget_alerts" {
  name = "budget-alerts-${var.project}-${var.environment}"
  tags = local.common_tags
}

# Subscriptions to the SNS topic (email, Slack, etc.)
resource "aws_sns_topic_subscription" "budget_alerts" {
  for_each = var.budget_alert_subscriptions
  topic_arn = aws_sns_topic.budget_alerts.arn
  protocol  = each.value.protocol
  endpoint  = each.value.endpoint
}
