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

variable "redis_secret_arn" {
  type = string
}

variable "db_host" {
  type = string
}

variable "redis_host" {
  description = "Redis replication-group primary endpoint (host:port). Clients must use this cluster endpoint, not an individual node address, so they follow the primary across a failover."
  type        = string
}

variable "redis_reader_host" {
  description = "Redis replication-group reader endpoint (host:port) for read-only clients."
  type        = string
  default     = null
}

variable "redis_tls_enabled" {
  description = "Whether the ElastiCache replication group requires TLS (transit encryption). When true the backend connects with the rediss:// scheme."
  type        = bool
  default     = false
}

variable "enable_blue_green" {
  description = "Enable blue/green deployment with CodeDeploy"
  type        = bool
  default     = false
}

variable "blue_green_deployment_config" {
  description = "Blue/green deployment configuration"
  type = object({
    termination_wait_time_in_minutes = optional(number, 30)
    deployment_ready_option = optional(object({
      action_on_timeout = optional(string, "CONTINUE_DEPLOYMENT")
    }), {})
  })
  default = {
    termination_wait_time_in_minutes = 30
    deployment_ready_option = {
      action_on_timeout = "CONTINUE_DEPLOYMENT"
    }
  }
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
