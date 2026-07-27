variable "secondary_region" {
  type        = string
  description = "AWS Secondary DR Region"
}

variable "app_name" {
  type        = string
  description = "Application Name"
}

variable "environment" {
  type        = string
  description = "Deployment Environment"
}

variable "primary_db_instance_arn" {
  type        = string
  description = "Primary RDS DB Instance ARN for cross-region replication"
}
