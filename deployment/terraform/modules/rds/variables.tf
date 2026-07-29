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

variable "master_user_secret_rotation_days" {
  description = "Number of days between automatic Secrets Manager rotations for the RDS managed master user secret. Set to 0 to disable rotation."
  type        = number
  default     = 30

  validation {
    condition     = var.master_user_secret_rotation_days == 0 || (var.master_user_secret_rotation_days >= 1 && var.master_user_secret_rotation_days <= 1000)
    error_message = "master_user_secret_rotation_days must be 0, or between 1 and 1000 days."
  }
}

variable "rotate_master_user_secret_immediately" {
  description = "Whether Secrets Manager should rotate the RDS master user secret immediately when rotation is enabled. Keep false for safer first rollout."
  type        = bool
  default     = false
}
