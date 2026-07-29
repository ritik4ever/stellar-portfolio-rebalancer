output "redis_endpoint" {
  value = "${aws_elasticache_replication_group.main.primary_endpoint_address}:${aws_elasticache_replication_group.main.port}"
}

output "redis_primary_endpoint_address" {
  value = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "redis_port" {
  value = aws_elasticache_replication_group.main.port
}

output "redis_auth_secret_arn" {
  value = aws_secretsmanager_secret.redis_auth.arn
}

output "redis_auth_rotation_enabled" {
  value = var.auth_token_rotation_days > 0
}
