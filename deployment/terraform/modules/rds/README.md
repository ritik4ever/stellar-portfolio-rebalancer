# RDS Module

PostgreSQL database plus automated backup retention and snapshot lifecycle management (Issue #1277).

## Backup retention

- `backup_retention_period` (module variable, default **7** days; staging `7`, production `14` via root `variables.tf`) sets `backup_retention_period` on `aws_db_instance.main`.
- RDS automated backups provide **daily snapshots** plus **point-in-time recovery** within the retention window.
- Changing the value modifies the instance **in place** (no replacement); AWS limit is 1–35 days (validated in the variable).
- `backup_window` (default `03:00-04:00` UTC) sets when the daily automated snapshot runs.

## Snapshot lifecycle

RDS automated backups are pruned automatically by AWS at the end of the retention window. Manual snapshots are **not** — so a Lambda function, provisioned entirely by this module, prunes them daily:

- **Schedule**: EventBridge rule, `snapshot_cleanup_schedule` variable (default `cron(30 4 * * ? *)` — daily 04:30 UTC, after the backup window).
- **Identification**: only manual snapshots tagged `SnapshotOwner = <name_prefix>` (e.g. `staging-portfolio`) are eligible. The Lambda also stamps `SnapshotEnvironment` (workspace name) on owned snapshots for console identification.
- **Eligibility**: status `available`, older than `backup_retention_period` days, and not the instance's `*-db-final` termination snapshot.
- **Safety**: snapshots without the exact `SnapshotOwner` tag (other projects, other environments, manually created untagged snapshots) are **never** selected. Failures on one snapshot don't block others; a CloudWatch alarm fires if any deletion fails.
- **Idempotent**: re-runs only see remaining snapshots.

The Lambda, its IAM role, schedule, permissions, logs, and error alarm are all provisioned by this module — no manual deployment or console steps. The deployment package is built by Terraform's `archive_file` from `lambda/snapshot-retention.mjs`.

## Snapshot metadata

| Tag | Meaning |
|---|---|
| `SnapshotOwner` | `<project>-<workspace>` (e.g. `staging-portfolio`) — ownership marker, also the deletion allowlist key |
| `SnapshotEnvironment` | workspace name (`staging`/`production`) |
| `SnapshotCreateTime` | visible in the AWS console for every snapshot |

`copy_tags_to_snapshot = true` also copies instance tags (Project/Environment/ManagedBy) onto automated and final snapshots.

## Recovery Point Objective (RPO)

With the default settings the **intended RPO is 24 hours** (daily automated snapshots), improvable to near-zero recovery loss via point-in-time recovery within the `backup_retention_period` window (PITR replays to any second in the window, subject to AWS RDS PITR mechanics). Actual recovery characteristics depend on AWS RDS backup behavior, the instance's backup window, and deployment configuration — the infrastructure does not guarantee an RPO tighter than the retention configuration above. Manual snapshots taken before risky changes survive only as long as the retention window; pin one by removing the `SnapshotOwner` tag if it must be kept indefinitely.

## Tests

`terraform test` (from `deployment/terraform/`) covers retention wiring, cleanup automation, IAM scope, and retention-change propagation using a mocked AWS provider.
