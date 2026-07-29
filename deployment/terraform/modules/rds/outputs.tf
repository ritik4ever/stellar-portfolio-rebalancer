output "db_endpoint" {
  value = aws_db_instance.main.endpoint
}

output "db_address" {
  value = aws_db_instance.main.address
}

output "db_port" {
  value = aws_db_instance.main.port
}

output "db_name" {
  value = aws_db_instance.main.db_name
}

output "db_secret_arn" {
  value = aws_db_instance.main.master_user_secret[0].secret_arn
}

output "db_secret_rotation_enabled" {
  value = var.master_user_secret_rotation_days > 0
}
