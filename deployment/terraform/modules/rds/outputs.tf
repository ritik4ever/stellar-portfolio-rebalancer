output "db_endpoint" {
  value = aws_db_instance.main.endpoint
}

output "db_secret_arn" {
  value = aws_db_instance.main.master_user_secret[0].secret_arn
}

output "backup_retention_period" {
  value       = aws_db_instance.main.backup_retention_period
  description = "Days of automated backups retained (point-in-time recovery window)"
}

output "snapshot_retention_lambda" {
  value       = aws_lambda_function.snapshot_retention.function_name
  description = "Lambda pruning manual snapshots past the retention window"
}
