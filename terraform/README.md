# Terraform Rollout Outcomes

This directory contains the Terraform configuration for the portfolio rebalancing workflow's infrastructure, including the AWS budget alerting stack.

## Rollout Outcome Signal

Terraform rollouts are not always all-or-nothing. A plan may apply some resources while failing on others, and downstream automation needs to tell the difference between a clean success, a transient delay, and blocked work. The `terraform/rollout_result.tf` module exposes a small, stable result signal for this purpose.

### Signal values

| Status    | Meaning                                                                 |
|-----------|-----------------------------------------------------------------------------------|
| `success` | Apply completed cleanly; all resources in the plan are in the desired state.                |
| `delay`   | Apply is in progress or hit a retryable / transient condition; wait and re-check.       |
| `blocked` | Apply failed or is partial in a way that requires human intervention; do not retry blindly. |

The signal is derived from Terraform's apply exit code and the compact summary emitted by the rollout wrapper. A partial apply that affects one service is reported as `blocked` and includes the affected service and its owner action so the correct team is notified.

## Usage

``hicl
module "rollout_result" {
  source = "./rollout_result"

  apply_exit_code = var.apply_exit_code
  apply_log      = var.apply_log
}

output "rollout_outcome" {
  value = module.rollout_result.outcome
}
```

The module returns an object with the following fields:
- `status`: one of `success`, `delay`, `blocked`.
- `service`: the service affected by a partial apply, or `null`.
- `owner_action`: the owner action required for the affected service, or `null`.
- `detail`: a short human-readable description of the outcome.

## Testing

Focused tests live in `terraform/tests/rollout_result_test.go` and cover the three distinguishable outcomes as well as the partial-apply signal for a single service.
