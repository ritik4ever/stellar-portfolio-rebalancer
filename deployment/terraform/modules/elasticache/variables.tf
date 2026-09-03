variable "name_prefix" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "node_type" {
  type = string
}

variable "transit_encryption_enabled" {
  description = "Enable transit encryption for Redis cluster"
  type        = bool
  default     = true
}

variable "auth_token_enabled" {
  description = "Enable AUTH token for Redis cluster"
  type        = bool
  default     = true
}

variable "replica_count" {
  description = "Number of Redis read replicas. Must be at least 1 so ElastiCache can fail over to a replica in another availability zone."
  type        = number
  default     = 1

  validation {
    condition     = var.replica_count >= 1
    error_message = "replica_count must be at least 1 so ElastiCache can fail over to a replica in another subnet/AZ."
  }

  validation {
    condition     = var.replica_count <= 5
    error_message = "replica_count must be at most 5 (ElastiCache allows a maximum of 5 read replicas per shard)."
  }
}

variable "at_rest_encryption_enabled" {
  description = "Enable at-rest encryption for the Redis replication group."
  type        = bool
  default     = true
}

variable "apply_immediately" {
  description = "Apply Redis replication group changes immediately instead of during the next maintenance window."
  type        = bool
  default     = true
}

variable "multi_az_enabled" {
  description = <<-EOT
    Enable Multi-AZ on the ElastiCache replication group.

    When true, ElastiCache provisions and manages the primary and its read
    replicas across different availability zones and automatically promotes a
    replica when the primary node — or the whole AZ hosting it — fails.
    Requires at least one read replica (replica_count >= 1) and two or more
    entries in availability_zones.
  EOT
  type        = bool
  default     = true

  validation {
    condition     = !var.multi_az_enabled || var.automatic_failover_enabled
    error_message = "automatic_failover_enabled must be true when multi_az_enabled is true."
  }

  validation {
    condition     = !var.multi_az_enabled || var.replica_count >= 1
    error_message = "multi_az_enabled requires at least one read replica (replica_count >= 1)."
  }

  validation {
    condition     = !var.multi_az_enabled || length(distinct(var.availability_zones)) >= 2
    error_message = "multi_az_enabled requires at least two DISTINCT entries in availability_zones (duplicates would place the replica in the primary's AZ) so the replica can be placed in a different AZ from the primary."
  }
}

variable "automatic_failover_enabled" {
  description = <<-EOT
    Promote a read replica automatically when the primary becomes unreachable.
    Must be true whenever multi_az_enabled is true.
  EOT
  type        = bool
  default     = true
}

variable "availability_zones" {
  description = <<-EOT
    Availability zones used to spread the primary and its read replicas.
    The first entry hosts the primary; replicas are allocated across the
    remaining entries (cycling when there are more replicas than AZs).
    Must contain at least one AZ, and at least two distinct AZs when
    multi_az_enabled is true. Every AZ listed must have a subnet in
    `subnet_ids`.
  EOT
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]

  # Guards the modulo in main.tf (`i % length(var.availability_zones)`): an
  # empty list would otherwise raise a division-by-zero at plan time.
  validation {
    condition     = length(var.availability_zones) >= 1
    error_message = "availability_zones must contain at least one AZ."
  }

  validation {
    condition     = length(distinct(var.availability_zones)) == length(var.availability_zones)
    error_message = "availability_zones must not contain duplicate entries."
  }
}
