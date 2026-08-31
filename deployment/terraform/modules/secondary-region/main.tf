// Secondary region DR module: provisions DR copies of core infra.

variable "secondary_region" {
  type = string
}

variable "primary_db_identifier" {
  type = string
}

variable "s3_buckets" {
  type = list(string)
  default = []
}

// ECS cluster in secondary region (empty cluster with same name)
resource "aws_ecs_cluster" "secondary_cluster" {
  name = "portfolio-backend-dr-cluster-${var.secondary_region}"
}

// RDS cross-region read replica
resource "aws_db_instance" "rds_read_replica" {
  identifier              = "portfolio-db-dr-${var.secondary_region}"
  instance_class         = "db.t3.medium"
  replicate_source_db    = var.primary_db_identifier
  skip_final_snapshot    = true
  publicly_accessible    = false
  apply_immediately      = false
  deletion_protection    = false
  # Additional parameters (storage, subnet group, parameter groups) should be provided by caller via overrides
}

// ElastiCache Redis placeholder - recommend using Global Datastore for cross-region
resource "aws_elasticache_replication_group" "redis_dr" {
  replication_group_id          = "portfolio-redis-dr-${var.secondary_region}"
  replication_group_description = "DR Redis replica in ${var.secondary_region}"
  node_type                     = "cache.t3.micro"
  number_cache_clusters         = 1
  automatic_failover_enabled    = false
  # For cross-region Redis, prefer using aws_elasticache_global_replication_group in the primary account.
}

// S3 replication configuration will be created for each bucket name passed in
resource "aws_s3_bucket" "replica_buckets" {
  for_each = toset(var.s3_buckets)
  bucket   = "${each.value}-dr-${var.secondary_region}"
  acl      = "private"
}

resource "aws_s3_bucket_public_access_block" "replica_block" {
  for_each = aws_s3_bucket.replica_buckets
  bucket = each.value.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

// Outputs useful for failover procedures
output "ecs_cluster_name" {
  value = aws_ecs_cluster.secondary_cluster.name
}

output "rds_read_replica_identifier" {
  value = aws_db_instance.rds_read_replica.id
}

output "replica_s3_buckets" {
  value = [for b in aws_s3_bucket.replica_buckets : b.bucket]
}
