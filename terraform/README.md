# Terraform Rollout Recovery — Root AWS Infrastructure Module

This directory contains the Terraform configuration for the portfolio rebalancing workflow's
AWS infrastructure: AWS Budgets alerting, SNS notification topics, and the rollout outcome
signal that downstream automation reads after `terraform apply`.

## Rollout Outcome Signal

Terraform applies are not atomic. When a plan applies some resources and then errors on others
the downstream CI step needs to tell the difference between three distinguishable outcomes:

| Signal | Meaning |
|---|---|
| `success` | Apply completed cleanly; all resources in the plan are in the desired state. |
| `transient_delay` | A retryable condition was encountered (e.g. a dependency not yet propagated). Wait and re-run. |
| `blocked` | Apply failed with a condition that requires owner intervention. **Do not retry blindly.** |

### How it works

The CI wrapper that calls `terraform apply` passes `-var rollout_outcome_signal=<value>`
based on the apply exit code and error output it inspects:

| Condition | Signal |
|---|---|
| Exit 0, no errored resources | `success` |
| Exit 0 or 1, errored resource with retry-able error text | `transient_delay` |
| Exit 1, non-retry-able error | `blocked` |

The structured result is assembled in `rollout_result.tf` as `local.rollout_result` and then
exposed through the following outputs:

| Output | Description |
|---|---|
| `rollout_outcome` | Signal token: `success`, `transient_delay`, or `blocked`. |
| `rollout_affected_service` | Name of the affected service, or `null` on a clean success. |
| `rollout_owner_action` | Remediation token (`retry_apply`, `resolve_blocker`), or `null` on success. |
| `rollout_result` | Structured object with `status`, `service`, `owner_action`, `is_partial`, `is_blocking`. |
| `budget_name` | Name of the monthly AWS Budget resource. |
| `budget_sns_topic_arn` | ARN of the SNS topic receiving budget alerts. |

### Reading the signal in CI

```bash
# Read the flattened outputs immediately after `terraform apply`
STATUS=$(terraform output -raw rollout_outcome)

case "$STATUS" in
  success)
    echo "Rollout complete."
    ;;
  transient_delay)
    ACTION=$(terraform output -raw rollout_owner_action)
    echo "Rollout is waiting — owner action: $ACTION"
    echo "Wait for the dependency to propagate, then re-run terraform apply."
    ;;
  blocked)
    ACTION=$(terraform output -raw rollout_owner_action)
    SERVICE=$(terraform output -raw rollout_affected_service)
    echo "::error::Rollout blocked on $SERVICE. Owner action: $ACTION"
    exit 1
    ;;
esac
```

### Safe rollback boundary for a `blocked` outcome

When the signal is `blocked`:

1. **Do NOT apply the plan again** without resolving the stated owner action.
2. Run `terraform plan` to confirm the remaining diff is limited to the affected service.
   If other resources are also drifted, escalate to the infrastructure team.
3. Fix the prerequisite identified by `rollout_owner_action`.
4. Apply with a targeted plan scoped to the affected service only:
   ```bash
   terraform apply -target=<affected_service_resource>
   ```
5. Re-read `rollout_outcome`. Proceed to a full apply only when it returns `success`.

## Validating Terraform Rollout from a Clean Environment (SPR-2026-271)

Contributors can validate the configuration, state consistency, and plan reproducibility from a clean checkout or isolated service without relying on undocumented local state.

### 1. Clean checkout prerequisites and defaults

All variables in `variables.tf` provide documented, self-contained defaults (`project = "stellar-portfolio-rebalancer"`, `environment = "dev"`, `region = "us-east-1"`, `rollout_outcome_signal = "success"`). No undocumented local `.tfvars`, uncommitted credentials, or machine-local state files are required for initialisation or validation:

```bash
# From a clean checkout without existing .terraform/ directories or local state:
cd terraform
terraform init -input=false
terraform fmt -check
terraform validate
```

### 2. Reproducing a plan with no infrastructure changes

To verify that an existing deployment has zero drift and matches the committed configuration:

```bash
# Check state consistency without local state contamination:
terraform plan -detailed-exitcode -no-color

# Or verify state refresh against remote infrastructure:
terraform plan -refresh-only
```

- **Exit code 0**: No infrastructure changes needed. State is consistent and up-to-date.
- **Exit code 2**: Differences present. Review the targeted diff before proceeding.
- **Exit code 1**: Error encountered during planning.

### 3. Isolated service plan and rollout

When isolating a single service or resource (e.g. budgets or notification topic):

```bash
# Plan changes isolated to the budget alerts topic:
terraform plan -target=aws_sns_topic.budget_alerts

# Apply changes to the isolated service only:
terraform apply -target=aws_sns_topic.budget_alerts
```

### 4. Rollback steps without undocumented local state

If an apply reports `blocked` or fails midway:

1. Inspect the structured signal output directly from state:
   ```bash
   terraform output -raw rollout_outcome
   terraform output -raw rollout_affected_service
   terraform output -raw rollout_owner_action
   ```
2. Confirm the blast radius is confined to the affected service:
   ```bash
   terraform plan -detailed-exitcode
   ```
3. Revert only the failed resource using the target address or restore from the remote state backend without destroying unrelated resources:
   ```bash
   terraform apply -target=<affected_service_resource> -var "rollout_outcome_signal=transient_delay"
   ```
4. Do not mutate local `.tfstate` files directly or delete remote lock entries outside approved runbooks.

### Variables

| Variable | Default | Description |
|---|---|---|
| `rollout_outcome_signal` | `"success"` | Signal token set by the CI wrapper after apply. |
| `rollout_affected_service` | `""` | Name of the service affected by a partial apply. |
| `rollout_owner_action` | `""` | Override token for the required remediation action. |

The `rollout_outcome_signal` variable validates that only `success`, `transient_delay`, or
`blocked` are accepted. Anything else fails at plan time.

### ECS-scoped recovery

The ECS module at `deployment/terraform/modules/ecs` receives the same `rollout_outcome_signal`
and `rollout_owner_action` variables and surfaces an ECS-specific signal shape — including the
cluster name, service name, target address, and a human-readable detail message — as its own
output block. See `deployment/terraform/modules/ecs/rollout_recovery.tf` for the full
step-by-step recovery procedure.

## Infrastructure resources

- `main.tf` — AWS provider, project locals, `rollout_outcome` local (mirrors the signal).
- `rollout_result.tf` — Structured `local.rollout_result` object and `rollout_result` output.
- `outputs.tf` — Flattened scalar outputs (`rollout_outcome`, `rollout_affected_service`, `rollout_owner_action`, `budget_name`, `budget_sns_topic_arn`).
- `sns.tf` — SNS topic and subscriptions for budget alerts.
- `budgets.tf` — AWS Budget resource with dynamic notification thresholds.
- `variables.tf` — All input variables, including rollout signal variables.
- `versions.tf` — Required Terraform (`>= 1.5.0`) and provider versions.

## Testing

```bash
# From this directory (terraform/)
terraform test
```

The native test suite in `terraform/tests/rollout_result.tftest.hcl` uses `mock_provider "aws" {}` to run fully offline without live credentials. It verifies:
- `success`: Produces null partial-apply fields and clean flags.
- `transient_delay`: Defaults `owner_action` to `retry_apply` and sets `is_partial = true`.
- `blocked`: Defaults `owner_action` to `resolve_blocker` and sets `is_blocking = true`.
- Custom `owner_action` overrides for non-success signals.
- Clean environment default plan reproduction.
- Validation constraint rejection of unknown signal tokens.

The ECS rollout recovery module has its own focused test suite at `deployment/terraform/tests/ecs_rollout_recovery.tftest.hcl`. Offline JavaScript integration tests are also executable via `node --test deployment/deploy.test.mjs`.

