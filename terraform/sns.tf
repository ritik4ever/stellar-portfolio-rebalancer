resource "aws_sns_topic" "budget_alerts" {
  name = "budget-alerts-${var.project}-${var.environment}"
  tags = local.common_tags
}

resource "aws_sns_topic_subscription" "email" {
  for_each = toset(var.notification_email)
  topic_arn = aws_sns_topic.budget_alerts.arn
  protocol  = "email"
  endpoint  = each.key
}
