resource "aws_sns_topic" "budget_alerts" {
  name = "budget-alerts-${var.project}-${var.environment}"
  tags = local.common_tags
}

resource "aws_sns_topic_subscription" "email" {
  for_each = toset(var.notification_email)
  topic_arn = aws_sns_topic.budget_alerts.arn
  protocol  = "email"
  endpoint = each.key
}

resource "aws_sns_topic_subscription" "slack" {
  count = var.notification_slack_webhook != "" ? 1 : 0
  topic_arn = aws_sns_topic.budget_alerts.arn
  protocol  = "https"
  endpoint = var.notification_slack_webhook
}

variable "budget_limit" {
  description = "Monthly budget limit in USD"
  type        = number
  default     = 1000
}

variable "budget_notification_thresholds" {
  description = "Percentage thresholds for budget alerts"
  type        = list(number)
  default     = [50, 80, 90]
}

resource "aws_budgets_budget" "monthly" {
  name         = "monthly-budget-${var.project}-${var.environment}"
  budget_type  = "COST"
  limit_amount = var.budget_limit
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  tags         = local.common_tags

  dynamic "notification" {
    for_each = var.budget_notification_thresholds
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_sns_topic_arns  = [aws_sns_topic.budget_alerts.arn]
    }
  }
}
