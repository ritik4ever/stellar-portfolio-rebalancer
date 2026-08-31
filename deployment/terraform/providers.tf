terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "stellar-portfolio-tf-state"
    key            = "${terraform.workspace}/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "stellar-portfolio-tf-locks"
    encrypt        = true
  }
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
