output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster hosting the backend service."
  value       = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  description = "Name of the ECS backend service."
  value       = aws_ecs_service.main.name
}

output "ecs_task_definition_family" {
  description = "Task definition family used by the ECS backend service."
  value       = aws_ecs_task_definition.main.family
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
  value       = try(aws_codedeploy_app.main[0].name, null)
}

output "deployment_group_name" {
  description = "Name of the CodeDeploy deployment group (if blue/green enabled)"
  value       = try(aws_codedeploy_deployment_group.main[0].deployment_group_name, null)
}

output "deployment_config_name" {
  description = "Name of the CodeDeploy deployment configuration (if blue/green enabled)"
  value       = try(aws_codedeploy_deployment_config.main[0].deployment_config_name, null)
}

output "deployment_sns_topic_arn" {
  description = "ARN of the deployment notifications SNS topic (if blue/green enabled)"
  value       = try(aws_sns_topic.deployment_notifications[0].arn, null)
}

output "test_listener_arn" {
  description = "ARN of the test listener on port 8080 (if blue/green enabled)"
  value       = try(aws_lb_listener.test[0].arn, null)
}
