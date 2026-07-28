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

variable "environment" {
  type        = string
  description = "Deployment environment (e.g. testnet, staging, mainnet) — added to snapshot tags."
  default     = "testnet"
}

variable "backup_retention_days" {
  type        = number
  description = "Number of days to retain automated RDS backups. Must be between 1 and 35."
  default     = 7

  validation {
    condition     = var.backup_retention_days >= 1 && var.backup_retention_days <= 35
    error_message = "backup_retention_days must be between 1 and 35."
  }
}

variable "snapshot_cold_storage_after_days" {
  type        = number
  description = "Days after creation before AWS Backup moves a snapshot to cold storage. Set to 0 to disable cold-storage tier."
  default     = 30
}

variable "snapshot_delete_after_days" {
  type        = number
  description = "Days after creation before AWS Backup permanently deletes a snapshot."
  default     = 90
}
