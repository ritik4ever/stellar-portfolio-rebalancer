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
  rollout_outcome = var.rollout_outcome_signal
}
