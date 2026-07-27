variable "primary_region" {
  type        = string
  description = "AWS Primary Region for Active Infrastructure"
  default     = "us-east-1"
}

variable "secondary_region" {
  type        = string
  description = "AWS Secondary DR Region for Failover Infrastructure"
  default     = "us-west-2"
}

variable "app_name" {
  type        = string
  description = "Application Name identifier"
  default     = "stellar-portfolio"
}

variable "environment" {
  type        = string
  description = "Deployment Environment (e.g. production, staging)"
  default     = "production"
}

variable "db_name" {
  type        = string
  description = "PostgreSQL Database Name"
  default     = "portfolio"
}

variable "db_user" {
  type        = string
  description = "PostgreSQL Master Username"
  default     = "portfolio_admin"
}

variable "db_password" {
  type        = string
  description = "PostgreSQL Master Password"
  sensitive   = true
  default     = "ChangeMeInProduction123!"
}
