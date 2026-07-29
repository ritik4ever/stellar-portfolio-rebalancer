variable "name_prefix" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "node_type" {
  type = string
}

variable "auth_token_rotation_days" {
  description = "Number of days between automatic Redis AUTH token rotations. Set to 0 to disable Secrets Manager rotation."
  type        = number
  default     = 30

  validation {
    condition     = var.auth_token_rotation_days == 0 || (var.auth_token_rotation_days >= 1 && var.auth_token_rotation_days <= 1000)
    error_message = "auth_token_rotation_days must be 0, or between 1 and 1000 days."
  }
}

variable "rotate_auth_token_immediately" {
  description = "Whether Secrets Manager should invoke the Redis AUTH token rotation Lambda immediately when rotation is enabled. Keep false for safer first rollout."
  type        = bool
  default     = false
}

variable "transit_encryption_enabled" {
  description = "Enables in-transit encryption. Redis AUTH token support requires this to be true on ElastiCache replication groups."
  type        = bool
  default     = true
}
