# Terraform native tests for the root rollout result and outcome signal (SPR-2026-271).
#
# These tests verify that the root rollout outcome signal defined in
# terraform/rollout_result.tf produces the correct structured object and scalar outputs
# for all three distinguishable outcomes:
#   • success         – clean apply; service and owner_action outputs are null.
#   • transient_delay – retryable condition; defaults to retry_apply.
#   • blocked         – hard blocker; defaults to resolve_blocker.
#
# Provider calls are mocked so the suite runs fully offline without live AWS state:
#   cd terraform && terraform test

mock_provider "aws" {}

# ── 1. Success signal ─────────────────────────────────────────────────────────

run "success_signal_produces_clean_rollout_result" {
  command = plan

  variables {
    rollout_outcome_signal = "success"
  }

  assert {
    condition     = output.rollout_outcome == "success"
    error_message = "rollout_outcome must be 'success' when signal is success."
  }

  assert {
    condition     = output.rollout_affected_service == null
    error_message = "rollout_affected_service must be null on a clean success."
  }

  assert {
    condition     = output.rollout_owner_action == null
    error_message = "rollout_owner_action must be null on a clean success."
  }

  assert {
    condition     = output.rollout_result.status == "success"
    error_message = "rollout_result.status must be 'success'."
  }

  assert {
    condition     = output.rollout_result.service == null
    error_message = "rollout_result.service must be null on a clean success."
  }

  assert {
    condition     = output.rollout_result.owner_action == null
    error_message = "rollout_result.owner_action must be null on a clean success."
  }

  assert {
    condition     = output.rollout_result.is_partial == false
    error_message = "rollout_result.is_partial must be false on success."
  }

  assert {
    condition     = output.rollout_result.is_blocking == false
    error_message = "rollout_result.is_blocking must be false on success."
  }
}

# ── 2. Transient-delay signal ─────────────────────────────────────────────────

run "transient_delay_defaults_to_retry_apply" {
  command = plan

  variables {
    rollout_outcome_signal   = "transient_delay"
    rollout_affected_service = "portfolio-rebalancing-service"
  }

  assert {
    condition     = output.rollout_outcome == "transient_delay"
    error_message = "rollout_outcome must be 'transient_delay'."
  }

  assert {
    condition     = output.rollout_affected_service == "portfolio-rebalancing-service"
    error_message = "rollout_affected_service must reflect the affected service."
  }

  assert {
    condition     = output.rollout_owner_action == "retry_apply"
    error_message = "rollout_owner_action must default to 'retry_apply' for transient_delay."
  }

  assert {
    condition     = output.rollout_result.status == "transient_delay"
    error_message = "rollout_result.status must be 'transient_delay'."
  }

  assert {
    condition     = output.rollout_result.service == "portfolio-rebalancing-service"
    error_message = "rollout_result.service must match rollout_affected_service."
  }

  assert {
    condition     = output.rollout_result.owner_action == "retry_apply"
    error_message = "rollout_result.owner_action must default to 'retry_apply'."
  }

  assert {
    condition     = output.rollout_result.is_partial == true
    error_message = "rollout_result.is_partial must be true for transient_delay."
  }

  assert {
    condition     = output.rollout_result.is_blocking == false
    error_message = "rollout_result.is_blocking must be false for transient_delay."
  }
}

# ── 3. Blocked signal ─────────────────────────────────────────────────────────

run "blocked_signal_defaults_to_resolve_blocker" {
  command = plan

  variables {
    rollout_outcome_signal   = "blocked"
    rollout_affected_service = "portfolio-rebalancing-service"
  }

  assert {
    condition     = output.rollout_outcome == "blocked"
    error_message = "rollout_outcome must be 'blocked'."
  }

  assert {
    condition     = output.rollout_affected_service == "portfolio-rebalancing-service"
    error_message = "rollout_affected_service must reflect the affected service."
  }

  assert {
    condition     = output.rollout_owner_action == "resolve_blocker"
    error_message = "rollout_owner_action must default to 'resolve_blocker' for blocked."
  }

  assert {
    condition     = output.rollout_result.status == "blocked"
    error_message = "rollout_result.status must be 'blocked'."
  }

  assert {
    condition     = output.rollout_result.service == "portfolio-rebalancing-service"
    error_message = "rollout_result.service must match rollout_affected_service."
  }

  assert {
    condition     = output.rollout_result.owner_action == "resolve_blocker"
    error_message = "rollout_result.owner_action must default to 'resolve_blocker'."
  }

  assert {
    condition     = output.rollout_result.is_partial == true
    error_message = "rollout_result.is_partial must be true for blocked."
  }

  assert {
    condition     = output.rollout_result.is_blocking == true
    error_message = "rollout_result.is_blocking must be true for blocked."
  }
}

# ── 4. Explicit owner action overrides default ────────────────────────────────

run "explicit_owner_action_overrides_default_for_transient_delay" {
  command = plan

  variables {
    rollout_outcome_signal   = "transient_delay"
    rollout_affected_service = "portfolio-rebalancing-service"
    rollout_owner_action     = "review_plan_and_apply"
  }

  assert {
    condition     = output.rollout_owner_action == "review_plan_and_apply"
    error_message = "rollout_owner_action must override the default 'retry_apply'."
  }

  assert {
    condition     = output.rollout_result.owner_action == "review_plan_and_apply"
    error_message = "rollout_result.owner_action must override the default 'retry_apply'."
  }
}

run "explicit_owner_action_overrides_default_for_blocked" {
  command = plan

  variables {
    rollout_outcome_signal   = "blocked"
    rollout_affected_service = "portfolio-rebalancing-service"
    rollout_owner_action     = "retry_apply"
  }

  assert {
    condition     = output.rollout_owner_action == "retry_apply"
    error_message = "rollout_owner_action must override the default 'resolve_blocker'."
  }

  assert {
    condition     = output.rollout_result.owner_action == "retry_apply"
    error_message = "rollout_result.owner_action must override the default 'resolve_blocker'."
  }
}

# ── 5. Clean environment plan reproducibility with defaults ───────────────────

run "clean_environment_plan_has_deterministic_defaults" {
  command = plan

  assert {
    condition     = output.budget_name == "monthly-stellar-portfolio-rebalancer-dev"
    error_message = "budget_name must use deterministic default naming."
  }

  assert {
    condition     = output.rollout_outcome == "success"
    error_message = "rollout_outcome must default to success."
  }

  assert {
    condition     = output.rollout_result.is_partial == false
    error_message = "rollout_result.is_partial must default to false."
  }
}

# ── 6. Variable validation rejects unknown signal values ──────────────────────

run "invalid_signal_value_is_rejected_by_validation" {
  command = plan

  variables {
    rollout_outcome_signal = "unknown_status"
  }

  expect_failures = [var.rollout_outcome_signal]
}
