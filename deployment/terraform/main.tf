# ─── Secondary-region DR wiring ──────────────────────────────────────────────
# Restored from the previous configuration, which declared this module with an
# unclosed block (invalid HCL that broke `terraform validate`). The block is
# now closed correctly. It must stay in the root module: removing it would make
# Terraform plan the destruction of every DR resource at this module address
# (the cross-region RDS read replica — which has skip_final_snapshot = true —
# the replica S3 buckets, and the DR ECS cluster).
#
# The `terraform {}` block that used to accompany this section is intentionally
# NOT restored: providers.tf already declares required_version and the AWS
# provider requirement, and a second required_version is invalid.

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

  secondary_region      = var.secondary_region
  primary_db_identifier = var.primary_db_identifier
  s3_buckets            = var.s3_buckets
}

locals {
  name_prefix = "${var.project_name}-${terraform.workspace}"
}

module "vpc" {
  source      = "./modules/vpc"
  name_prefix = local.name_prefix
  vpc_cidr    = var.vpc_cidr
  azs         = var.azs
}

# ─── Optional: deploy rotation Lambdas ───────────────────────────────────────
# This module is enabled when create_rotation_lambda = true.
# It provisions the SAR-managed RDS rotation Lambda and a custom Redis rotation
# Lambda, both inside the VPC.  The output ARNs are forwarded to the rds and
# elasticache modules below so that aws_secretsmanager_secret_rotation is wired
# up automatically.

module "rotation_lambda" {
  count  = var.create_rotation_lambda ? 1 : 0
  source = "./modules/rotation_lambda"

  name_prefix                = local.name_prefix
  vpc_id                     = module.vpc.vpc_id
  private_subnet_ids         = module.vpc.private_subnet_ids
  redis_secret_arn           = module.elasticache.redis_secret_arn
  redis_replication_group_id = module.elasticache.redis_replication_group_id

  depends_on = [module.vpc, module.elasticache]
}

# Resolve the effective rotation Lambda ARNs:
#   • If create_rotation_lambda=true  → use the ARNs from the module above.
#   • Otherwise                       → fall back to the caller-supplied ARN
#     (secret_rotation_lambda_arn), which may be null (disables rotation).
locals {
  effective_rds_rotation_lambda_arn = (
    var.create_rotation_lambda
    ? module.rotation_lambda[0].rds_rotation_lambda_arn
    : var.secret_rotation_lambda_arn
  )
  effective_redis_rotation_lambda_arn = (
    var.create_rotation_lambda
    ? module.rotation_lambda[0].redis_rotation_lambda_arn
    : var.secret_rotation_lambda_arn
  )
}

# ─── Redis AUTH secret rotation ───────────────────────────────────────────────
# This resource lives in the root module rather than in modules/elasticache on
# purpose: the rotation_lambda module below needs the ElastiCache replication
# group ID and secret ARN, so attaching rotation *inside* the elasticache
# module created an elasticache → rotation_lambda → elasticache dependency
# cycle that made `terraform validate`/`apply` fail.  Owning the attachment
# here keeps the graph acyclic while preserving identical behaviour.
resource "aws_secretsmanager_secret_rotation" "redis_auth" {
  count               = local.effective_redis_rotation_lambda_arn == null ? 0 : 1
  secret_id           = module.elasticache.redis_secret_arn
  rotation_lambda_arn = local.effective_redis_rotation_lambda_arn

  rotation_rules {
    automatically_after_days = var.secret_rotation_days
  }
}

module "rds" {
  source                     = "./modules/rds"
  name_prefix                = local.name_prefix
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.private_subnet_ids
  instance_class             = lookup(var.db_instance_class, terraform.workspace, "db.t4g.micro")
  secret_rotation_days       = var.secret_rotation_days
  secret_rotation_lambda_arn = local.effective_rds_rotation_lambda_arn
}

module "elasticache" {
  source      = "./modules/elasticache"
  name_prefix = local.name_prefix
  vpc_id      = module.vpc.vpc_id
  subnet_ids  = module.vpc.private_subnet_ids
  node_type   = lookup(var.redis_node_type, terraform.workspace, "cache.t4g.micro")

  # ─── High availability ────────────────────────────────────────────────────
  # Multi-AZ + automatic failover with at least one read replica pinned to a
  # different AZ than the primary. Both AZs are guaranteed to have a private
  # subnet because the VPC module creates one subnet per entry in var.azs.
  multi_az_enabled           = var.redis_multi_az_enabled
  automatic_failover_enabled = var.redis_automatic_failover_enabled
  replica_count              = lookup(var.redis_replica_count, terraform.workspace, 1)
  availability_zones         = var.azs
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
  # Redis clients talk to the *replication-group* endpoints (primary for
  # writes, reader for reads), never to an individual node address. These
  # DNS names are repointed by ElastiCache during a failover, so the app
  # only needs to reconnect — no configuration change.
  redis_host                   = module.elasticache.redis_primary_endpoint
  redis_reader_host            = module.elasticache.redis_reader_endpoint
  redis_tls_enabled            = module.elasticache.transit_encryption_enabled
  enable_blue_green            = lookup(var.enable_blue_green, terraform.workspace, false)
  blue_green_deployment_config = var.blue_green_deployment_config
  ecs_min_capacity             = lookup(var.ecs_min_capacity, terraform.workspace, 1)
  ecs_max_capacity             = lookup(var.ecs_max_capacity, terraform.workspace, 5)
}

module "s3_cloudfront" {
  source      = "./modules/s3_cloudfront"
  name_prefix = local.name_prefix
}

module "budgets" {
  source                   = "./modules/budgets"
  name_prefix              = local.name_prefix
  project_tag              = "StellarPortfolioRebalancer"
  environment_tag          = terraform.workspace
  monthly_cost_limit       = lookup(var.monthly_cost_limit, terraform.workspace, 100.0)
  notification_emails      = var.budget_notification_emails
  notification_sns_topics  = var.budget_notification_sns_topics
  create_sns_topic         = var.create_budget_sns_topic
  enable_service_budgets   = var.enable_service_budgets
  ec2_usage_limit          = var.ec2_usage_limit
  enable_anomaly_detection = var.enable_cost_anomaly_detection
  daily_spend_threshold    = var.daily_spend_threshold
}
