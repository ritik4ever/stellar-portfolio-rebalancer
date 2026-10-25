output "vpc_id" {
  value = module.vpc.vpc_id
}

output "backend_url" {
  value = module.ecs.alb_dns_name
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster hosting the backend service."
  value       = module.ecs.ecs_cluster_name
}

output "ecs_service_name" {
  description = "Name of the ECS backend service."
  value       = module.ecs.ecs_service_name
}

output "ecs_task_definition_family" {
  description = "Task definition family used by the ECS backend service."
  value       = module.ecs.ecs_task_definition_family
}

output "ecs_codedeploy_app_name" {
  description = "CodeDeploy application name, or null when blue/green is disabled."
  value       = module.ecs.codedeploy_app_name
}

output "ecs_codedeploy_deployment_group_name" {
  description = "CodeDeploy deployment group name, or null when blue/green is disabled."
  value       = module.ecs.deployment_group_name
}

output "ecs_codedeploy_deployment_config_name" {
  description = "CodeDeploy deployment configuration name, or null when blue/green is disabled."
  value       = module.ecs.deployment_config_name
}

output "frontend_url" {
  value = module.s3_cloudfront.cloudfront_domain_name
}

output "cloudfront_distribution_id" {
  value = module.s3_cloudfront.cloudfront_distribution_id
}

output "db_secret_arn" {
  value       = module.rds.db_secret_arn
  description = "ARN of the Secrets Manager secret containing RDS credentials"
}

output "redis_secret_arn" {
  value       = module.elasticache.redis_secret_arn
  description = "ARN of the Secrets Manager secret containing Redis AUTH token"
}

output "redis_replication_group_id" {
  value       = module.elasticache.redis_replication_group_id
  description = "ElastiCache replication-group ID used to inspect rotation state."
}

output "rds_rotation_lambda_arn" {
  value       = var.create_rotation_lambda ? module.rotation_lambda[0].rds_rotation_lambda_arn : var.secret_rotation_lambda_arn
  description = "ARN of the Lambda function rotating the RDS master-user secret. Null when rotation is disabled."
}

output "redis_rotation_lambda_arn" {
  value       = var.create_rotation_lambda ? module.rotation_lambda[0].redis_rotation_lambda_arn : var.secret_rotation_lambda_arn
  description = "ARN of the Lambda function rotating the Redis AUTH token secret. Null when rotation is disabled."
}

output "secret_rotation_schedule_days" {
  value       = var.secret_rotation_days
  description = "Configured rotation interval in days for both RDS and Redis secrets."
}

output "redis_primary_endpoint" {
  value       = module.elasticache.redis_primary_endpoint
  description = "ElastiCache replication-group primary endpoint (host:port) used by the backend for reads and writes."
}

output "redis_reader_endpoint" {
  value       = module.elasticache.redis_reader_endpoint
  description = "ElastiCache replication-group reader endpoint (host:port) for read-only clients."
}

output "redis_multi_az_enabled" {
  value       = module.elasticache.multi_az_enabled
  description = "Whether Multi-AZ is enabled on the ElastiCache replication group."
}

output "redis_automatic_failover_enabled" {
  value       = module.elasticache.automatic_failover_enabled
  description = "Whether automatic failover is enabled on the ElastiCache replication group."
}

output "redis_num_cache_clusters" {
  value       = module.elasticache.num_cache_clusters
  description = "Total ElastiCache node count (1 primary + N read replicas)."
}

output "redis_preferred_cache_cluster_azs" {
  value       = module.elasticache.preferred_cache_cluster_azs
  description = "Availability zones the primary and each read replica are pinned to."
}

# ─── Rollout recovery outputs ─────────────────────────────────────────────────
# These outputs let the CI post-apply step read the rollout signal and decide
# whether to proceed, wait, or halt and notify the owner.
#
# Usage (in the CI step that follows `terraform apply`):
#
#   STATUS=$(terraform output -raw rollout_outcome)
#   case "$STATUS" in
#     success)        echo "Rollout complete." ;;
#     transient_delay) echo "Waiting for ECS to stabilize…" ;;
#     blocked)
#       ACTION=$(terraform output -raw rollout_owner_action)
#       SERVICE=$(terraform output -raw rollout_affected_service)
#       echo "::error::Rollout blocked on $SERVICE. Owner action: $ACTION"
#       exit 1 ;;
#   esac

output "rollout_outcome" {
  description = "Overall rollout outcome: success, transient_delay, or blocked."
  value       = var.rollout_outcome_signal
}

output "rollout_affected_service" {
  description = "Service affected by a partial apply, or null on a clean success."
  value = (
    var.rollout_outcome_signal == "success"
    ? null
    : (var.rollout_affected_service != "" ? var.rollout_affected_service : module.ecs.ecs_rollout_affected_service)
  )
}

output "rollout_owner_action" {
  description = "Remediation token for the operator, or null on a clean success."
  value       = var.rollout_outcome_signal == "success" ? null : module.ecs.ecs_rollout_owner_action
}

output "ecs_rollout_status" {
  description = "ECS-service-scoped rollout status mirrored from the ECS module."
  value       = module.ecs.ecs_rollout_status
}

output "ecs_rollout_cluster" {
  description = "ECS cluster name for the affected service, or null on success."
  value       = module.ecs.ecs_rollout_cluster
}

output "ecs_rollout_detail" {
  description = "Human-readable description of the ECS rollout outcome."
  value       = module.ecs.ecs_rollout_detail
}

output "ecs_rollout_target_address" {
  description = "Terraform -target address for a scoped recovery apply, or null on success."
  value       = module.ecs.ecs_rollout_target_address
}
