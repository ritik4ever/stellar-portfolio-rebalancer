locals {
  name_prefix = "${var.project_name}-${terraform.workspace}"
}

module "vpc" {
  source      = "./modules/vpc"
  name_prefix = local.name_prefix
  vpc_cidr    = var.vpc_cidr
}

module "rds" {
  source                     = "./modules/rds"
  name_prefix                = local.name_prefix
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.private_subnet_ids
  instance_class             = lookup(var.db_instance_class, terraform.workspace, "db.t4g.micro")
  secret_rotation_days       = var.secret_rotation_days
  secret_rotation_lambda_arn = var.secret_rotation_lambda_arn
}

module "elasticache" {
  source                     = "./modules/elasticache"
  name_prefix                = local.name_prefix
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.private_subnet_ids
  node_type                  = lookup(var.redis_node_type, terraform.workspace, "cache.t4g.micro")
  secret_rotation_days       = var.secret_rotation_days
  secret_rotation_lambda_arn = var.secret_rotation_lambda_arn
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
  redis_secret_arn   = module.elasticache.redis_secret_arn
  db_host            = module.rds.db_endpoint
  redis_host         = module.elasticache.redis_endpoint
  enable_blue_green  = lookup(var.enable_blue_green, terraform.workspace, false)
  blue_green_deployment_config = var.blue_green_deployment_config
  ecs_min_capacity   = lookup(var.ecs_min_capacity, terraform.workspace, 1)
  ecs_max_capacity   = lookup(var.ecs_max_capacity, terraform.workspace, 5)
}

module "s3_cloudfront" {
  source      = "./modules/s3_cloudfront"
  name_prefix = local.name_prefix
}

module "budgets" {
  source              = "./modules/budgets"
  name_prefix         = local.name_prefix
  project_tag         = "StellarPortfolioRebalancer"
  environment_tag     = terraform.workspace
  monthly_cost_limit  = lookup(var.monthly_cost_limit, terraform.workspace, 100.0)
  notification_emails = var.budget_notification_emails
  notification_sns_topics = var.budget_notification_sns_topics
  create_sns_topic    = var.create_budget_sns_topic
  enable_service_budgets = var.enable_service_budgets
  ec2_usage_limit     = var.ec2_usage_limit
  enable_anomaly_detection = var.enable_cost_anomaly_detection
  daily_spend_threshold = var.daily_spend_threshold
}
