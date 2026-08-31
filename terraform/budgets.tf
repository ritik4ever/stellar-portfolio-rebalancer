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
      threshold                  = notification.value * 100
      notification_type          = "ACTUAL"
      subscriber_sns_topic_arns = [aws_sns_topic.budget_alerts.arn]
    }
  }
}
