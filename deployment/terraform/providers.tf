terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # NOTE: To use an S3 backend for remote state, uncomment and configure below.
  # backend "s3" {
  #   bucket         = "stellar-portfolio-tf-state"
  #   key            = "state/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "stellar-portfolio-tf-locks"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "StellarPortfolioRebalancer"
      Environment = terraform.workspace
      ManagedBy   = "Terraform"
    }
  }
}
