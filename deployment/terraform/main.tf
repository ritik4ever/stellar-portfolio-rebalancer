locals {
  name_prefix = "${var.project_name}-${terraform.workspace}"
}

module "vpc" {
  source      = "./modules/vpc"
  name_prefix = local.name_prefix
  vpc_cidr    = var.vpc_cidr
}

module "rds" {
  source         = "./modules/rds"
  name_prefix    = local.name_prefix
  vpc_id         = module.vpc.vpc_id
  subnet_ids     = module.vpc.private_subnet_ids
  instance_class = lookup(var.db_instance_class, terraform.workspace, "db.t4g.micro")
}

module "elasticache" {
  source      = "./modules/elasticache"
  name_prefix = local.name_prefix
  vpc_id      = module.vpc.vpc_id
  subnet_ids  = module.vpc.private_subnet_ids
  node_type   = lookup(var.redis_node_type, terraform.workspace, "cache.t4g.micro")
}

module "ecs" {
  source             = "./modules/ecs"
  name_prefix        = local.name_prefix
  vpc_id             = module.vpc.vpc_id
  public_subnet_ids  = module.vpc.public_subnet_ids
  private_subnet_ids = module.vpc.private_subnet_ids
  task_cpu           = lookup(var.ecs_task_cpu, terraform.workspace, 256)
  task_memory        = lookup(var.ecs_task_memory, terraform.workspace, 512)
  db_secret_arn      = module.rds.db_secret_arn
  db_host            = module.rds.db_endpoint
  redis_host         = module.elasticache.redis_endpoint
}

module "s3_cloudfront" {
  source      = "./modules/s3_cloudfront"
  name_prefix = local.name_prefix
}
