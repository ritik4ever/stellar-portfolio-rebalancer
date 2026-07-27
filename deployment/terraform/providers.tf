terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  alias  = "primary"
  region = var.primary_region

  default_tags {
    tags = {
      Environment = var.environment
      Project     = var.app_name
      Role        = "Primary"
      ManagedBy   = "Terraform"
    }
  }
}

provider "aws" {
  alias  = "secondary"
  region = var.secondary_region

  default_tags {
    tags = {
      Environment = var.environment
      Project     = var.app_name
      Role        = "DisasterRecovery"
      ManagedBy   = "Terraform"
    }
  }
}
