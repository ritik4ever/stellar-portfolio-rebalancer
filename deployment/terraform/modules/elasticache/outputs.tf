output "redis_endpoint" {
  value = "${aws_elasticache_cluster.main.cache_nodes[0].address}:${aws_elasticache_cluster.main.cache_nodes[0].port}"
}

output "redis_secret_arn" {
  value       = aws_secretsmanager_secret.redis_auth.arn
  description = "ARN of the Secrets Manager secret containing Redis AUTH token"
}

output "redis_auth_token" {
  value       = random_password.redis_auth.result
  sensitive   = true
  description = "The Redis AUTH token generated for the cluster"
}
