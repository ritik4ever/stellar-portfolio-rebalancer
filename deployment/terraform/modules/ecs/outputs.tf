output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "blue_target_group_arn" {
  description = "ARN of the blue target group"
  value       = aws_lb_target_group.main.arn
}

output "green_target_group_arn" {
  description = "ARN of the green target group (if blue/green enabled)"
  value       = try(aws_lb_target_group.green[0].arn, null)
}

output "codedeploy_app_name" {
  description = "Name of the CodeDeploy application (if blue/green enabled)"
  value       = try(aws_ecodedeploy_app.main[0].name, null)
}

output "deployment_group_name" {
  description = "Name of the CodeDeploy deployment group (if blue/green enabled)"
  value       = try(aws_codedeploy_deployment_group.main[0].deployment_group_name, null)
}

output "deployment_sns_topic_arn" {
  description = "ARN of the deployment notifications SNS topic (if blue/green enabled)"
  value       = try(aws_sns_topic.deployment_notifications[0].arn, null)
}
