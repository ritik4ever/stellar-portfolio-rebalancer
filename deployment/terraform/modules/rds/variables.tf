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
