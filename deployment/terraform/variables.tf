variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "stellar-portfolio"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = map(string)
  default = {
    staging    = "db.t4g.micro"
    production = "db.t4g.small"
  }
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = map(string)
  default = {
    staging    = "cache.t4g.micro"
    production = "cache.t4g.small"
  }
}

variable "ecs_task_cpu" {
  description = "ECS Task CPU"
  type        = map(number)
  default = {
    staging    = 256
    production = 512
  }
}

variable "ecs_task_memory" {
  description = "ECS Task Memory"
  type        = map(number)
  default = {
    staging    = 512
    production = 1024
  }
}

variable "secret_rotation_days" {
  description = "Number of days between automatic scheduled rotations of database and redis credentials"
  type        = number
  default     = 30
}

variable "secret_rotation_lambda_arn" {
  description = "ARN of the Lambda function that rotates secrets (optional when using AWS managed rotation)"
  type        = string
  default     = null
}
