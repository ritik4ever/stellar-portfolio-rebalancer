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
