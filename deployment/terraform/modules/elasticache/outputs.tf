output "redis_endpoint" {
  value       = "${aws_elasticache_replication_group.main.primary_endpoint_address}:${aws_elasticache_replication_group.main.port}"
  description = "Primary Redis replication-group endpoint (host:port) used by backend writers and BullMQ. This is the cluster/replication-group endpoint, NOT a single node address — it follows the primary during failover."
}

output "redis_primary_endpoint_address" {
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
  description = "Primary Redis endpoint address for write traffic and automatic failover."
}

output "redis_primary_endpoint" {
  value       = "${aws_elasticache_replication_group.main.primary_endpoint_address}:${aws_elasticache_replication_group.main.port}"
  description = "Primary (writer) replication-group endpoint as host:port."
}

output "redis_reader_endpoint_address" {
  value       = aws_elasticache_replication_group.main.reader_endpoint_address
  description = "Reader endpoint address for read-only Redis clients."
}

output "redis_reader_endpoint" {
  value       = "${aws_elasticache_replication_group.main.reader_endpoint_address}:${aws_elasticache_replication_group.main.port}"
  description = "Reader (read-only) endpoint as host:port, load balanced across all read replicas."
}

output "redis_port" {
  value       = aws_elasticache_replication_group.main.port
  description = "Port the replication group listens on."
}

output "redis_replication_group_id" {
  value       = aws_elasticache_replication_group.main.id
  description = "ElastiCache replication group ID."
}

output "multi_az_enabled" {
  value       = aws_elasticache_replication_group.main.multi_az_enabled
  description = "Whether Multi-AZ is enabled on the replication group."
}

output "automatic_failover_enabled" {
  value       = aws_elasticache_replication_group.main.automatic_failover_enabled
  description = "Whether automatic failover is enabled on the replication group."
}

output "num_cache_clusters" {
  value       = aws_elasticache_replication_group.main.num_cache_clusters
  description = "Total node count of the replication group (1 primary + replica_count read replicas)."
}

output "node_count" {
  value       = local.node_count
  description = "Configured node count (1 primary + replica_count read replicas)."
}

output "preferred_cache_cluster_azs" {
  value       = local.preferred_azs
  description = "Availability zones the primary and each read replica are pinned to, in allocation order."
}

output "availability_zones" {
  value       = var.availability_zones
  description = "Availability-zone pool the replication group spreads its nodes across."
}

output "transit_encryption_enabled" {
  value       = aws_elasticache_replication_group.main.transit_encryption_enabled
  description = "Whether in-transit encryption (TLS) is enabled — clients must connect with rediss:// when true."
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
