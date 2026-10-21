provider "aws" {
  region = var.region
}

locals {
  project_name = var.project
  environment  = var.environment
  common_tags = {
    Project     = local.project_name
    Environment = local.environment
    ManagedBy   = "Terraform"
  }
  # Rollout outcome signal for the rebalancing workflow.
  # Query this output after apply to distinguish success, transient delay,
  # and blocked work for a partial apply affecting a single service.
  rollout_outcome = var.rollout_outcome
}

output "rollout_outcome" {
  description = "Result signal for the Terraform rollout: success, transient_delay, or blocked."
  value       = local.rollout_outcome
}

output "rollout_affected_service" {
  description = "Service affected by a partial apply, if any."
  value       = var.rollout_affected_service
}

output "rollout_owner_action" {
  description = "Owner action required to resolve a transient delay or blocked rollout."
  value       = var.rollout_owner_action
}
