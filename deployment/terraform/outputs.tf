output "vpc_id" {
  value = module.vpc.vpc_id
}

output "backend_url" {
  value = module.ecs.alb_dns_name
}

output "frontend_url" {
  value = module.s3_cloudfront.cloudfront_domain_name
}

output "db_secret_arn" {
  value       = module.rds.db_secret_arn
  description = "ARN of the Secrets Manager secret containing RDS credentials"
}
