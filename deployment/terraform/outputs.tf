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
