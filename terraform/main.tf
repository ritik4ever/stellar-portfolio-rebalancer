provider "aws" {
  region = var.region
}

locals {
  project_name = var.project
  environment  = var.environment
  common_tags = {
    Project     = local.project_name
    Environment = local.environment
    ManagedBy   = "Terraform"
  }
}
