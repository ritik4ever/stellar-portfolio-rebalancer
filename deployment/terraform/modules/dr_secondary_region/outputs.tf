output "vpc_id" {
  value       = aws_vpc.secondary.id
  description = "Secondary DR VPC ID"
}

output "dr_replica_arn" {
  value       = aws_db_instance.dr_replica.arn
  description = "Secondary DR Read Replica ARN"
}

output "dr_replica_endpoint" {
  value       = aws_db_instance.dr_replica.endpoint
  description = "Secondary DR Read Replica Endpoint"
}

output "ecs_cluster_name" {
  value       = aws_ecs_cluster.secondary.name
  description = "Secondary DR ECS Cluster Name"
}

output "s3_bucket_name" {
  value       = aws_s3_bucket.secondary_dr.id
  description = "Secondary DR S3 Bucket Name"
}

output "s3_bucket_arn" {
  value       = aws_s3_bucket.secondary_dr.arn
  description = "Secondary DR S3 Bucket ARN"
}
