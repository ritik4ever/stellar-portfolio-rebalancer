output "vpc_id" {
  value       = aws_vpc.primary.id
  description = "Primary VPC ID"
}

output "db_instance_arn" {
  value       = aws_db_instance.primary.arn
  description = "Primary RDS DB Instance ARN"
}

output "db_instance_identifier" {
  value       = aws_db_instance.primary.identifier
  description = "Primary RDS DB Instance Identifier"
}

output "db_endpoint" {
  value       = aws_db_instance.primary.endpoint
  description = "Primary RDS DB Endpoint"
}

output "ecs_cluster_name" {
  value       = aws_ecs_cluster.primary.name
  description = "Primary ECS Cluster Name"
}

output "s3_bucket_name" {
  value       = aws_s3_bucket.primary.id
  description = "Primary S3 Bucket Name"
}

output "s3_bucket_arn" {
  value       = aws_s3_bucket.primary.arn
  description = "Primary S3 Bucket ARN"
}
