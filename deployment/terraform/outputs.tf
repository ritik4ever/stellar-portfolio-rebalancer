output "vpc_id" {
  value = module.vpc.vpc_id
}

output "backend_url" {
  value = module.ecs.alb_dns_name
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
