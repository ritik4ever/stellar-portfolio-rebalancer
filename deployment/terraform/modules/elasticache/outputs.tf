output "redis_endpoint" {
  value       = "${aws_elasticache_replication_group.main.primary_endpoint_address}:${aws_elasticache_replication_group.main.port}"
  description = "Primary Redis replication-group endpoint used by backend writers and BullMQ."
}

output "redis_primary_endpoint_address" {
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
  description = "Primary Redis endpoint address for write traffic and automatic failover."
}

output "redis_reader_endpoint_address" {
  value       = aws_elasticache_replication_group.main.reader_endpoint_address
  description = "Reader endpoint address for read-only Redis clients."
}

output "redis_replication_group_id" {
  value       = aws_elasticache_replication_group.main.id
  description = "ElastiCache replication group ID."
}

output "redis_secret_arn" {
  value       = aws_secretsmanager_secret.redis_auth.arn
  description = "ARN of the Secrets Manager secret containing Redis AUTH token"
}

output "redis_auth_token" {
  value       = random_password.redis_auth.result
  sensitive   = true
  description = "The Redis AUTH token generated for the replication group"
}
