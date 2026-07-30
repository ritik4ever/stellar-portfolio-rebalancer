variable "primary_region" {
  type        = string
  description = "AWS Primary Region"
}

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

variable "db_name" {
  type        = string
  description = "PostgreSQL Database Name"
}

variable "db_user" {
  type        = string
  description = "PostgreSQL Master Username"
}

variable "db_password" {
  type        = string
  description = "PostgreSQL Master Password"
  sensitive   = true
}

variable "dr_s3_bucket_arn" {
  type        = string
  description = "Destination S3 Bucket ARN in DR secondary region for cross-region replication"
  default     = ""
}
