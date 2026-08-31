terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 4.0"
    }
  }
}

variable "secondary_region" {
  description = "The AWS region to provision DR resources into"
  type        = string
}

variable "primary_db_identifier" {
  description = "The identifier / ARN of the primary RDS instance to replicate from"
  type        = string
}

variable "s3_buckets" {
  description = "List of S3 buckets to configure cross-region replication for (source bucket names)"
  type        = list(string)
  default     = []
}

provider "aws" {
  region = var.secondary_region
  alias  = "secondary"
}

module "secondary_region" {
  source = "./modules/secondary-region"

  providers = {
    aws = aws.secondary
  }

  secondary_region        = var.secondary_region
  primary_db_identifier   = var.primary_db_identifier
  s3_buckets              = var.s3_buckets
}
