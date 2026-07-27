# Root Terraform Configuration - Multi-Region Active/DR Deployment

module "dr_secondary_region" {
  source = "./modules/dr_secondary_region"

  providers = {
    aws = aws.secondary
  }

  secondary_region        = var.secondary_region
  app_name                = var.app_name
  environment             = var.environment
  primary_db_instance_arn = module.primary_region.db_instance_arn
}

module "primary_region" {
  source = "./modules/primary_region"

  providers = {
    aws = aws.primary
  }

  primary_region   = var.primary_region
  secondary_region = var.secondary_region
  app_name         = var.app_name
  environment      = var.environment
  db_name          = var.db_name
  db_user          = var.db_user
  db_password      = var.db_password
  dr_s3_bucket_arn = module.dr_secondary_region.s3_bucket_arn
}
