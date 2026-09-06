variable "secondary_region" {
  description = "Target secondary AWS region"
  type        = string
}

variable "primary_db_identifier" {
  description = "Identifier or ARN of the primary RDS instance to replicate from"
  type        = string
}

variable "s3_buckets" {
  description = "List of S3 bucket names to replicate"
  type        = list(string)
  default     = []
}
