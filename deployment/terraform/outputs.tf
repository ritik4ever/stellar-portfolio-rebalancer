output "primary_db_endpoint" {
  value       = module.primary_region.db_endpoint
  description = "Primary PostgreSQL Database Endpoint"
}

output "dr_replica_db_endpoint" {
  value       = module.dr_secondary_region.dr_replica_endpoint
  description = "Secondary DR Read Replica Database Endpoint"
}

output "primary_ecs_cluster_name" {
  value       = module.primary_region.ecs_cluster_name
  description = "Primary ECS Cluster Name"
}

output "dr_ecs_cluster_name" {
  value       = module.dr_secondary_region.ecs_cluster_name
  description = "Secondary DR ECS Cluster Name"
}

output "primary_s3_bucket" {
  value       = module.primary_region.s3_bucket_name
  description = "Primary Region S3 Bucket Name"
}

output "dr_s3_bucket" {
  value       = module.dr_secondary_region.s3_bucket_name
  description = "Secondary DR Region S3 Destination Bucket Name"
}
