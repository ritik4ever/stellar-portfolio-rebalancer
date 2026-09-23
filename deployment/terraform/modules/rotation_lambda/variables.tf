variable "name_prefix" {
  description = "Prefix applied to all resource names, e.g. stellar-portfolio-staging"
  type        = string
}

variable "vpc_id" {
  description = "VPC in which the rotation Lambdas are deployed"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnets for the rotation Lambda VPC config"
  type        = list(string)
}

# Optional: caller can override the derived SG by passing its own
variable "rotation_sg_id" {
  description = "Optional security group ID to pass to the SAR-deployed RDS rotation Lambda. If empty, the module's own rotation_lambda SG is used."
  type        = string
  default     = ""
}

variable "enable_rds_rotation" {
  description = "Deploy the SAR-managed RDS PostgreSQL rotation Lambda"
  type        = bool
  default     = true
}

variable "rds_rotation_sar_version" {
  description = "SecretsManagerRDSPostgreSQLRotationSingleUser SAR semantic version to deploy. Pin this to a known-good version in production."
  type        = string
  default     = "1.1.367"
}

variable "enable_redis_rotation" {
  description = "Deploy the custom Redis AUTH token rotation Lambda"
  type        = bool
  default     = true
}

variable "redis_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the Redis AUTH token"
  type        = string
}

variable "redis_replication_group_id" {
  description = "ElastiCache replication group ID whose AUTH token this Lambda rotates"
  type        = string
}
