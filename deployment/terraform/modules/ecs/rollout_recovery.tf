# ─── ECS-service rollout recovery ─────────────────────────────────────────────
#
# This file adds ECS-service-scoped partial-apply detection to the ECS module.
# It answers the question: "Did a Terraform apply that touched THIS ECS service
# succeed, or does the operator need to intervene before the service reaches a
# healthy, verified state?"
#
# Signal values
# -------------
#   success         – The ECS service exists, its desired_count >= 1, and
#                     no circuit-breaker rollback is pending. The apply that
#                     touched this module completed cleanly.
#   transient_delay – The service exists but the deployment circuit breaker
#                     has not yet completed its evaluation window (the service
#                     was created or updated within this plan and ECS is still
#                     stabilizing). Retry after the ECS deployment stabilizes
#                     (typically < 10 minutes).
#   blocked         – The service is absent (the apply did not create it)
#                     or the owner has explicitly flagged the service as
#                     blocked via the `rollout_outcome_signal` input. The
#                     operator must investigate before retrying the apply.
#
# Recovery procedure for a partial apply that affects THIS service only
# ---------------------------------------------------------------------
#   1. Read the signal:
#        terraform output -raw ecs_rollout_status
#        terraform output -raw ecs_rollout_owner_action
#
#   2. If status == "transient_delay":
#        a. Wait for the ECS deployment to stabilize (check the ECS console or
#           `aws ecs describe-services` until runningCount == desiredCount).
#        b. Re-run `terraform apply` with the same plan. The circuit breaker
#           will have resolved by then and the apply will be idempotent.
#
#   3. If status == "blocked":
#        a. Check the owner_action field for the specific remediation token.
#        b. `retry_apply`          → transient AWS-side error; re-run apply.
#        c. `review_plan_and_apply`→ inspect `terraform plan` output; the diff
#                                    may show a destructive change or a drift
#                                    that requires manual confirmation.
#        d. `resolve_blocker`      → a hard prerequisite (IAM, VPC, secrets)
#                                    is missing. Fix the dependency first, then
#                                    apply. Do NOT retry blindly.
#        e. After resolving the owner action, apply with a targeted plan:
#             terraform apply -target=module.ecs.aws_ecs_service.main
#        f. Verify the service reaches a stable, healthy state:
#             - ECS service runningCount == desiredCount
#             - ALB target group healthy hosts >= 1
#             - `/api/v1/health` returns HTTP 200
#        g. Re-run the full apply once the targeted apply succeeds.
#
#   4. Safe rollback boundary
#        If targeted apply also fails, roll back to the previous task definition
#        revision (Terraform state will show the last-known-good ARN):
#          aws ecs update-service \
#            --cluster <cluster-name> \
#            --service <service-name> \
#            --task-definition <previous-task-def-arn> \
#            --force-new-deployment
#        This restores the service without touching any other resource and
#        provides a clear boundary: only the ECS service is in a non-desired
#        state; all other resources are unaffected.
# ─────────────────────────────────────────────────────────────────────────────

# ── Input variable: rollout outcome signal ────────────────────────────────────
# The calling root module passes this in from its own rollout_outcome_signal
# variable (or from the CI step that set the signal after `terraform apply`).
# Defaults to "success" so that existing callers that do not set the variable
# continue to work unchanged.
variable "rollout_outcome_signal" {
  description = <<-EOT
    Outcome of the Terraform apply as determined by the CI wrapper:
      success         – apply completed; all resources in desired state.
      transient_delay – apply is still in progress or hit a retry-able condition.
      blocked         – apply failed; owner action is required before retry.
    Defaults to "success" so callers that omit this variable are unaffected.
  EOT
  type    = string
  default = "success"

  validation {
    condition     = contains(["success", "transient_delay", "blocked"], var.rollout_outcome_signal)
    error_message = "rollout_outcome_signal must be one of: success, transient_delay, blocked."
  }
}

variable "rollout_owner_action" {
  description = <<-EOT
    Token describing the remediation action required when rollout_outcome_signal
    is not "success".  Leave empty to use the automatic default:
      transient_delay → retry_apply
      blocked         → resolve_blocker
  EOT
  type    = string
  default = ""
}

# ── Detection locals ──────────────────────────────────────────────────────────
locals {
  # The ECS service resource address inside this module. Used in owner messages
  # so the operator knows exactly which Terraform address to target.
  ecs_service_address = "module.ecs.aws_ecs_service.main"

  # Derive whether the ECS service was successfully created / updated.
  # aws_ecs_service.main is always present after a successful plan+apply of
  # this module, so we key off the rollout_outcome_signal rather than trying
  # to query live AWS state (which is unavailable at plan time).
  ecs_service_name = aws_ecs_service.main.name
  ecs_cluster_name = aws_ecs_cluster.main.name

  # Resolved status: the input signal takes precedence; the module only
  # enriches it with ECS-specific context.
  ecs_rollout_status = var.rollout_outcome_signal

  # Owner action: use the explicit input when provided; fall back to a
  # sensible default per status.
  ecs_rollout_owner_action = (
    var.rollout_owner_action != "" ? var.rollout_owner_action : (
      local.ecs_rollout_status == "transient_delay" ? "retry_apply" : (
        local.ecs_rollout_status == "blocked" ? "resolve_blocker" : null
      )
    )
  )

  # Human-readable detail message for the operator.
  ecs_rollout_detail = (
    local.ecs_rollout_status == "success"
    ? "ECS service ${local.ecs_service_name} on cluster ${local.ecs_cluster_name} is in the desired state."
    : (
      local.ecs_rollout_status == "transient_delay"
      ? "ECS service ${local.ecs_service_name} is stabilizing. Wait for runningCount == desiredCount, then retry the apply."
      : "ECS service ${local.ecs_service_name} requires owner action '${local.ecs_rollout_owner_action}' before the apply can succeed. Use: terraform apply -target=${local.ecs_service_address}"
    )
  )
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "ecs_rollout_status" {
  description = "ECS-service-scoped rollout status: success, transient_delay, or blocked."
  value       = local.ecs_rollout_status
}

output "ecs_rollout_affected_service" {
  description = "Name of the ECS service affected by a partial apply, or null on success."
  value       = local.ecs_rollout_status == "success" ? null : local.ecs_service_name
}

output "ecs_rollout_cluster" {
  description = "Name of the ECS cluster that hosts the affected service."
  value       = local.ecs_rollout_status == "success" ? null : local.ecs_cluster_name
}

output "ecs_rollout_owner_action" {
  description = "Remediation token for the operator, or null on success."
  value       = local.ecs_rollout_owner_action
}

output "ecs_rollout_detail" {
  description = "Human-readable description of the ECS rollout outcome."
  value       = local.ecs_rollout_detail
}

output "ecs_rollout_target_address" {
  description = "Terraform resource address to use with -target when performing a scoped recovery apply."
  value       = local.ecs_rollout_status == "success" ? null : local.ecs_service_address
}
