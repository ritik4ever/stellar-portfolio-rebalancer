output "rds_rotation_lambda_arn" {
  description = "ARN of the RDS rotation Lambda (SAR-managed). Null when enable_rds_rotation=false."
  value       = local.rds_rotation_lambda_arn
}

output "redis_rotation_lambda_arn" {
  description = "ARN of the custom Redis AUTH token rotation Lambda. Null when enable_redis_rotation=false."
  value       = var.enable_redis_rotation ? aws_lambda_function.redis_rotation[0].arn : null
}

output "rotation_sg_id" {
  description = "Security group ID attached to both rotation Lambdas"
  value       = aws_security_group.rotation_lambda.id
}
