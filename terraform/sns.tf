resource "aws_sns_topic" "budget_alerts" {
  name = "budget-alerts-${var.project}-${var.environment}"
  tags = local.common_tags
}

resource "aws_sns_topic_subscription" "email" {
  for_each = toseet(var.notification_email)
  topic_arn = aws_sns_topic.budget_alerts.arn
  protocol  = "email"
  endpoint  = each.key
}

resource "aws_sns_topic_subscription" "slack" {
  count = var.notification_slack_webhook != "" ? 1 : 0
  topic_arn = aws_sns_topic.budget_alerts.arn
  protocol  = "https"
  endpoint  = var.notification_slack_webhook
}
