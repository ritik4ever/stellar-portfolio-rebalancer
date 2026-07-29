variable "name_prefix" {
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

variable "redis_host" {
  type = string
}

variable "ecs_min_capacity" {
  description = "Minimum number of tasks to run"
  type        = number
  default     = 1
}

variable "ecs_max_capacity" {
  description = "Maximum number of tasks to run"
  type        = number
  default     = 5
}

variable "queue_backlog_high_threshold" {
  description = "The queue backlog depth to trigger a scale-out"
  type        = number
  default     = 100
}

variable "queue_backlog_low_threshold" {
  description = "The queue backlog depth to trigger a scale-in"
  type        = number
  default     = 10
}
