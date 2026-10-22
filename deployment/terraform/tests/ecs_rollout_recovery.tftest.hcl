# Terraform native tests for the ECS rollout recovery module (SPR-2026-272).
#
# These tests verify that the rollout-recovery signal defined in
# deployment/terraform/modules/ecs/rollout_recovery.tf produces the correct
# outputs for all three distinguishable outcomes:
#   • success        – clean apply; service/owner_action outputs are null.
#   • transient_delay – ECS is still stabilizing; default owner action is
#                       retry_apply; the service address is populated.
#   • blocked        – hard prerequisite failure; default owner action is
#                       resolve_blocker; the target address is populated.
#
# Provider calls are mocked so the suite runs fully offline via `terraform test`.
# The suite also verifies that a custom rollout_owner_action token overrides the
# default, and that the variable validation rejects unknown signal values.
#
# Run:
#   cd deployment/terraform/modules/ecs
#   terraform test

mock_provider "aws" {}

# ── 1. Success signal ─────────────────────────────────────────────────────────
# When rollout_outcome_signal = "success" (the default), the module must expose
# null for all partial-apply fields and a human-readable detail confirming the
# service is in the desired state.

run "success_signal_nulls_partial_apply_fields" {
  command = plan

  variables {
    rollout_outcome_signal = "success"
  }

  assert {
    condition     = output.ecs_rollout_status == "success"
    error_message = "ecs_rollout_status must be 'success' when the signal is success."
  }

  assert {
    condition     = output.ecs_rollout_affected_service == null
    error_message = "ecs_rollout_affected_service must be null on a clean success."
  }

  assert {
    condition     = output.ecs_rollout_cluster == null
    error_message = "ecs_rollout_cluster must be null on a clean success."
  }

  assert {
    condition     = output.ecs_rollout_owner_action == null
    error_message = "ecs_rollout_owner_action must be null when the rollout succeeds."
  }

  assert {
    condition     = output.ecs_rollout_target_address == null
    error_message = "ecs_rollout_target_address must be null on a clean success."
  }

  assert {
    condition     = strcontains(output.ecs_rollout_detail, "desired state")
    error_message = "ecs_rollout_detail must confirm the service is in the desired state on success."
  }
}

# ── 2. Transient-delay signal ─────────────────────────────────────────────────
# When rollout_outcome_signal = "transient_delay" and no explicit owner action
# is provided, the module must default the owner action to "retry_apply" and
# populate the service and target address so callers know which resource to watch.

run "transient_delay_sets_retry_apply_owner_action" {
  command = plan

  variables {
    rollout_outcome_signal = "transient_delay"
  }

  assert {
    condition     = output.ecs_rollout_status == "transient_delay"
    error_message = "ecs_rollout_status must reflect the transient_delay signal."
  }

  assert {
    condition     = output.ecs_rollout_owner_action == "retry_apply"
    error_message = "ecs_rollout_owner_action must default to 'retry_apply' for a transient delay."
  }

  assert {
    condition     = output.ecs_rollout_affected_service != null
    error_message = "ecs_rollout_affected_service must be populated for a transient delay."
  }

  assert {
    condition     = output.ecs_rollout_target_address != null
    error_message = "ecs_rollout_target_address must be populated for a transient delay so callers can issue a targeted apply."
  }

  assert {
    condition     = strcontains(output.ecs_rollout_detail, "stabilizing")
    error_message = "ecs_rollout_detail must indicate the service is stabilizing during a transient delay."
  }
}

# ── 3. Blocked signal ─────────────────────────────────────────────────────────
# When rollout_outcome_signal = "blocked" and no explicit owner action is
# provided, the module must default to "resolve_blocker" and surface the
# Terraform -target address for a scoped recovery apply.

run "blocked_signal_sets_resolve_blocker_owner_action" {
  command = plan

  variables {
    rollout_outcome_signal = "blocked"
  }

  assert {
    condition     = output.ecs_rollout_status == "blocked"
    error_message = "ecs_rollout_status must reflect the blocked signal."
  }

  assert {
    condition     = output.ecs_rollout_owner_action == "resolve_blocker"
    error_message = "ecs_rollout_owner_action must default to 'resolve_blocker' when the rollout is blocked."
  }

  assert {
    condition     = output.ecs_rollout_affected_service != null
    error_message = "ecs_rollout_affected_service must be populated when the rollout is blocked."
  }

  assert {
    condition     = output.ecs_rollout_target_address == "module.ecs.aws_ecs_service.main"
    error_message = "ecs_rollout_target_address must point to the ECS service resource for a targeted recovery apply."
  }

  assert {
    condition     = strcontains(output.ecs_rollout_detail, "owner action")
    error_message = "ecs_rollout_detail must reference the required owner action when the rollout is blocked."
  }
}

# ── 4. Custom owner action overrides the default ──────────────────────────────
# When the caller supplies an explicit rollout_owner_action token, it must take
# precedence over the automatic default for both transient_delay and blocked.

run "explicit_owner_action_overrides_default_for_transient_delay" {
  command = plan

  variables {
    rollout_outcome_signal = "transient_delay"
    rollout_owner_action   = "review_plan_and_apply"
  }

  assert {
    condition     = output.ecs_rollout_owner_action == "review_plan_and_apply"
    error_message = "A custom rollout_owner_action must override the default 'retry_apply' for transient_delay."
  }
}

run "explicit_owner_action_overrides_default_for_blocked" {
  command = plan

  variables {
    rollout_outcome_signal = "blocked"
    rollout_owner_action   = "retry_apply"
  }

  assert {
    condition     = output.ecs_rollout_owner_action == "retry_apply"
    error_message = "A custom rollout_owner_action must override the default 'resolve_blocker' for blocked."
  }
}

# ── 5. Variable validation rejects unknown signal values ──────────────────────
# The rollout_outcome_signal variable has a validation block that restricts
# values to the three known tokens. Anything else must fail fast so that a
# misconfigured CI step is caught at plan time rather than silently passing
# through as an unrecognised status.

run "invalid_signal_value_is_rejected_by_validation" {
  command = plan

  variables {
    rollout_outcome_signal = "unknown_status"
  }

  expect_failures = [var.rollout_outcome_signal]
}
