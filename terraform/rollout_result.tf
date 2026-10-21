# ─── Rollout result: partial-apply detection ─────────────────────────────────
#
# Purpose
# -------
# A Terraform apply is not guaranteed to be atomic. When a plan applies some
# resources and then errors on others, downstream automation needs to tell the
# difference between three distinguishable outcomes:
#
#   success        – all resources in the plan are in the desired state.
#   transient_delay – one service change is pending a retry-able condition
#                     (e.g., a dependency not yet propagated). Callers should
#                     wait and re-run the apply.
#   blocked        – a service change failed or hit a condition that requires
#                     owner intervention before a retry will succeed. Callers
#                     must NOT retry blindly; they must notify the owner.
#
# How it works
# ------------
# The CI step that calls `terraform apply` passes `-var rollout_outcome_signal=<value>`
# based on the apply exit code and any error output it inspects:
#
#   • exit 0, no errored resources  → success
#   • exit 0 or 1, errored resource, retry-able error text
#                                   → transient_delay  (with affected_service set)
#   • exit 1, non-retry-able error  → blocked          (with affected_service set)
#
# The outputs produced here are surfaced at the root-module level by
# terraform/outputs.tf and can be read by the CI step immediately after apply:
#
#   terraform output -raw rollout_outcome
#   terraform output -raw rollout_affected_service
#   terraform output -raw rollout_owner_action
#
# The ECS-scoped variant lives in
# deployment/terraform/modules/ecs/rollout_recovery.tf and feeds the same
# signal shape for the ECS service specifically.
#
# Safe rollback boundary
# ----------------------
# When the signal is "blocked":
#   1. Do NOT apply the plan again without resolving the stated owner action.
#   2. Run `terraform plan` to confirm the remaining diff is limited to the
#      affected service. If other resources are also drifted, escalate.
#   3. Apply `terraform apply -target=<affected_service_resource>` only after
#      the owner action is complete and verified.
#   4. Re-read rollout_outcome after the targeted apply. Proceed to a full
#      apply only when the signal returns "success".
# ─────────────────────────────────────────────────────────────────────────────

locals {
  # Derive a structured result object from the three rollout signal variables.
  # Downstream automation reads individual fields from this object via the
  # flattened outputs below rather than from the object directly, so the shape
  # is an implementation detail that can evolve without breaking callers.
  rollout_result = {
    # Overall status token. One of: success | transient_delay | blocked.
    status = var.rollout_outcome_signal

    # Name of the single service affected by a partial apply, or null.
    # Always null on a clean success so the CI step can gate on this field
    # without extra string comparisons.
    service = var.rollout_outcome_signal == "success" ? null : (
      var.rollout_affected_service != "" ? var.rollout_affected_service : null
    )

    # Token describing the action the owning team must take, or null.
    #   retry_apply            – transient condition; re-run terraform apply.
    #   review_plan_and_apply  – inspect the diff first, then apply.
    #   resolve_blocker        – a hard prerequisite is missing; fix it first.
    owner_action = var.rollout_outcome_signal == "success" ? null : (
      var.rollout_owner_action != "" ? var.rollout_owner_action : (
        var.rollout_outcome_signal == "transient_delay" ? "retry_apply" : "resolve_blocker"
      )
    )

    # Boolean flags provided for callers that prefer simple conditionals.
    is_partial  = var.rollout_outcome_signal != "success"
    is_blocking = var.rollout_outcome_signal == "blocked"
  }
}

# Expose the structured result as a single output for tooling that can consume
# objects (e.g. a post-apply script using `terraform output -json`).
output "rollout_result" {
  description = "Structured rollout result: status, service, owner_action, is_partial, is_blocking."
  value       = local.rollout_result
}
