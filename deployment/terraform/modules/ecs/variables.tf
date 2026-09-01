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
  type = string
}

variable "deployment_type" {
  description = "Deployment type: BLUE_GREEN or ROLLING"
  type        = string
  default     = "ROLLING"
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
    lifecycle_hooks = optional(list(object({
      lifecycle_hook_name = string
      target_group_name   = string
      container_name      = string
      container_port      = number
    })), [])
  })
  default = {}
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
