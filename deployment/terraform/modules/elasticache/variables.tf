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

variable "secret_rotation_days" {
  description = "Number of days between automatic secret rotations"
  type        = number
  default     = 30
}

variable "secret_rotation_lambda_arn" {
  description = "ARN of the Lambda function that rotates the secret"
  type        = string
  default     = null
}

variable "transit_encryption_enabled" {
  description = "Enable transit encryption for Redis cluster"
  type        = bool
  default     = true
}

variable "auth_token_enabled" {
  description = "Enable AUTH token for Redis cluster"
  type        = bool
  default     = true
}
variable "replica_count" {
  description = "Number of Redis read replicas. Set to at least 1 to enable automatic failover and Multi-AZ placement."
  type        = number
  default     = 1

  validation {
    condition     = var.replica_count >= 1
    error_message = "replica_count must be at least 1 so ElastiCache can fail over to a replica in another subnet/AZ."
  }
}

variable "at_rest_encryption_enabled" {
  description = "Enable at-rest encryption for the Redis replication group."
  type        = bool
  default     = true
}

variable "apply_immediately" {
  description = "Apply Redis replication group changes immediately instead of during the next maintenance window."
  type        = bool
  default     = true
}
