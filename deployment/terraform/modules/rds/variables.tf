variable "name_prefix" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "instance_class" {
  type = string
}

variable "secret_rotation_days" {
  description = "Number of days between automatic secret rotations"
  type        = number
  default     = 30
}

variable "secret_rotation_lambda_arn" {
  description = "ARN of the Lambda function that rotates the secret (optional if using AWS managed rotation)"
  type        = string
  default     = null
}

variable "backup_retention_period" {
  description = <<-EOT
    Days of RDS automated backups to retain (drives both point-in-time recovery
    and the snapshot cleanup window). Unit: days. Allowed: 1-35 (AWS limit).
    Changing this value modifies the RDS instance in place (no replacement).
  EOT
  type        = number
  default     = 7

  validation {
    condition     = var.backup_retention_period >= 1 && var.backup_retention_period <= 35
    error_message = "backup_retention_period must be between 1 and 35 days (AWS RDS limits)."
  }
}

variable "backup_window" {
  description = "Preferred daily backup window (UTC), e.g. '03:00-04:00'. AWS may shift it if it conflicts with maintenance."
  type        = string
  default     = "03:00-04:00"

  validation {
    condition     = can(regex("^[0-9]{2}:[0-9]{2}-[0-9]{2}:[0-9]{2}$", var.backup_window))
    error_message = "backup_window must look like 'HH:MM-HH:MM' in UTC."
  }
}

variable "snapshot_cleanup_schedule" {
  description = "EventBridge schedule for the snapshot cleanup Lambda (cron/rate expression, UTC). Default: daily at 04:30 UTC, after the backup window."
  type        = string
  default     = "cron(30 4 * * ? *)"
}

variable "environment" {
  description = "Environment label (workspace name) stamped onto snapshot tags for identification."
  type        = string
  default     = "staging"
}
