variable "name_prefix" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "task_cpu" {
  type = number
}

variable "task_memory" {
  type = number
}

variable "db_secret_arn" {
  type = string
}

variable "db_host" {
  type = string
}

variable "db_port" {
  type = number
}

variable "db_name" {
  type = string
}

variable "redis_host" {
  type = string
}

variable "redis_port" {
  type = number
}

variable "redis_secret_arn" {
  type = string
}
