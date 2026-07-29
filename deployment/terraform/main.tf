locals {
  name_prefix = "${var.project_name}-${terraform.workspace}"
}

module "vpc" {
  source      = "./modules/vpc"
  name_prefix = local.name_prefix
  vpc_cidr    = var.vpc_cidr
}

module "rds" {
  source                                = "./modules/rds"
  name_prefix                           = local.name_prefix
  vpc_id                                = module.vpc.vpc_id
  subnet_ids                            = module.vpc.private_subnet_ids
  instance_class                        = lookup(var.db_instance_class, terraform.workspace, "db.t4g.micro")
  master_user_secret_rotation_days      = var.db_secret_rotation_days
  rotate_master_user_secret_immediately = var.rotate_secrets_immediately
}

module "elasticache" {
  source                        = "./modules/elasticache"
  name_prefix                   = local.name_prefix
  vpc_id                        = module.vpc.vpc_id
  subnet_ids                    = module.vpc.private_subnet_ids
  node_type                     = lookup(var.redis_node_type, terraform.workspace, "cache.t4g.micro")
  auth_token_rotation_days      = var.redis_auth_token_rotation_days
  rotate_auth_token_immediately = var.rotate_secrets_immediately
}

module "ecs" {
  source             = "./modules/ecs"
  name_prefix        = local.name_prefix
  aws_region         = var.aws_region
  vpc_id             = module.vpc.vpc_id
  public_subnet_ids  = module.vpc.public_subnet_ids
  private_subnet_ids = module.vpc.private_subnet_ids
  task_cpu           = lookup(var.ecs_task_cpu, terraform.workspace, 256)
  task_memory        = lookup(var.ecs_task_memory, terraform.workspace, 512)
  db_secret_arn      = module.rds.db_secret_arn
  db_host            = module.rds.db_address
  db_port            = module.rds.db_port
  db_name            = module.rds.db_name
  redis_host         = module.elasticache.redis_primary_endpoint_address
  redis_port         = module.elasticache.redis_port
  redis_secret_arn   = module.elasticache.redis_auth_secret_arn
}

module "s3_cloudfront" {
  source      = "./modules/s3_cloudfront"
  name_prefix = local.name_prefix
}
