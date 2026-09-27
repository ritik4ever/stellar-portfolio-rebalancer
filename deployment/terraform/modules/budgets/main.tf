# AWS Budgets Module
# Defines cost and usage budgets with alert notifications

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

# Monthly cost budget
resource "aws_budgets_budget" "monthly_cost" {
  name              = "${var.name_prefix}-monthly-cost-budget"
  budget_type       = "COST"
  limit_amount      = var.monthly_cost_limit
  limit_unit        = "USD"
  time_period_end   = "2087-06-15_00:00"
  time_period_start = "2024-01-01_00:00"
  time_unit         = "MONTHLY"

  # Cost filters to scope the budget to project-specific resources
  cost_filter {
    name = "TagKeyValue"
    values = [
      "Project$${var.project_tag}",
    ]
  }

  # Notification at 50% of budget
  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.notification_emails
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
  }

  # Notification at 75% of budget
  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.notification_emails
    threshold                  = 75
    threshold_type             = "PERCENTAGE"
  }

  # Notification at 90% of budget
  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.notification_emails
    subscriber_sns_topic_arns  = var.notification_sns_topics
    threshold                  = 90
    threshold_type             = "PERCENTAGE"
  }

  # Notification at 100% of budget (critical)
  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.notification_emails
    subscriber_sns_topic_arns  = var.notification_sns_topics
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
  }

  # Forecasted budget alert at 80%
  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.notification_emails
    subscriber_sns_topic_arns  = var.notification_sns_topics
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
  }

  tags = {
    Project     = var.project_tag
    Environment = var.environment_tag
    ManagedBy   = "Terraform"
  }
}

# Usage budget for specific services (optional)
resource "aws_budgets_budget" "ec2_usage" {
  count             = var.enable_service_budgets ? 1 : 0
  name              = "${var.name_prefix}-ec2-usage-budget"
  budget_type       = "USAGE"
  limit_amount      = var.ec2_usage_limit
  limit_unit        = "GB-Hours"
  time_period_end   = "2087-06-15_00:00"
  time_period_start = "2024-01-01_00:00"
  time_unit         = "MONTHLY"

  cost_filter {
    name = "Service"
    values = [
      "Amazon Elastic Compute Cloud - Compute",
      "AWS Lambda",
      "Amazon ECS",
    ]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.notification_emails
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
  }

  tags = {
    Project     = var.project_tag
    Environment = var.environment_tag
    ManagedBy   = "Terraform"
  }
}

# SNS Topic for budget alerts (if not provided externally)
resource "aws_sns_topic" "budget_alerts" {
  count = var.create_sns_topic ? 1 : 0
  name  = "${var.name_prefix}-budget-alerts"

  tags = {
    Project     = var.project_tag
    Environment = var.environment_tag
    ManagedBy   = "Terraform"
  }
}

resource "aws_sns_topic_policy" "budget_alerts" {
  count = var.create_sns_topic ? 1 : 0
  arn   = aws_sns_topic.budget_alerts[0].arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "budgets.amazonaws.com"
        }
        Action   = "SNS:Publish"
        Resource = aws_sns_topic.budget_alerts[0].arn
      }
    ]
  })
}

# CloudWatch Alarms for cost anomalies (optional)
resource "aws_cloudwatch_metric_alarm" "daily_spend_anomaly" {
  count               = var.enable_anomaly_detection ? 1 : 0
  alarm_name          = "${var.name_prefix}-daily-spend-anomaly"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "EstimatedCharges"
  namespace           = "AWS/Billing"
  period              = 86400 # 1 day
  statistic           = "Maximum"
  threshold           = var.daily_spend_threshold
  alarm_description   = "Alert when daily spend exceeds threshold"
  alarm_actions       = var.create_sns_topic ? [aws_sns_topic.budget_alerts[0].arn] : var.notification_sns_topics

  dimensions = {
    Currency = "USD"
  }

  tags = {
    Project     = var.project_tag
    Environment = var.environment_tag
    ManagedBy   = "Terraform"
  }
}
