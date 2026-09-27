# Credential Rotation Runbook

**Document type:** Operational Runbook  
**Feature:** Automated DB / Redis credential rotation via AWS Secrets Manager  
**Issue:** [#1293](../../../) – Add automated DB/Redis credential rotation  
**Last updated:** 2026-08-31

---

## Overview

RDS (PostgreSQL) and ElastiCache (Redis) credentials rotate automatically on a defined schedule through AWS Secrets Manager.  The backend services pick up new credentials proactively (background refresh every 4 minutes) and reactively (auto-retry on auth errors), so no manual intervention is needed under normal circumstances.

This runbook covers:

1. How to verify a rotation succeeded
2. How to manually trigger a rotation
3. How to force the backend to pick up new credentials without a restart
4. How to roll back to a previous secret version if rotation fails

---

## Architecture recap

| Component | Mechanism |
|-----------|-----------|
| RDS secret | `manage_master_user_password = true` on the `aws_db_instance` resource.  AWS stores the credential in Secrets Manager and the rotation Lambda (SAR-managed `SecretsManagerRDSPostgreSQLRotationSingleUser`) rotates it automatically. |
| Redis AUTH token secret | Custom `aws_secretsmanager_secret` + a bespoke rotation Lambda (`redis_rotation_handler.py`) that uses ElastiCache's two-token ROTATE strategy to avoid downtime. |
| Backend | `CredentialManager` fetches the latest secret from Secrets Manager with a 5-minute TTL cache and a background refresh every 4 minutes.  DB pool and Redis connection are rebuilt on the next credential change. |
| Rotation schedule | Staging: 30 days.  Production: 14 days.  Configurable via `secret_rotation_days` in `.tfvars`. |

---

## 1. Verify a rotation succeeded

### 1a. Check the secret version in AWS Console

1. Open **AWS Secrets Manager** → find `<env>-db` and `<env>-redis-auth-token` secrets.
2. Under **Rotation** tab verify:
   - "Last rotated" timestamp is recent.
   - There is a version labelled `AWSCURRENT` and the previous version is `AWSPREVIOUS`.

### 1b. Check via AWS CLI

```bash
# Check RDS secret rotation status
aws secretsmanager describe-secret \
  --secret-id "<name_prefix>-db" \
  --query '{LastRotatedDate:LastRotatedDate,RotationEnabled:RotationEnabled,NextRotationDate:NextRotationDate}'

# Check Redis secret rotation status
aws secretsmanager describe-secret \
  --secret-id "<name_prefix>-redis-auth-token" \
  --query '{LastRotatedDate:LastRotatedDate,RotationEnabled:RotationEnabled,NextRotationDate:NextRotationDate}'
```

### 1c. Verify the backend picked up the new credentials

Call the credential status admin endpoint.  You need an admin Stellar keypair (`ADMIN_PUBLIC_KEYS`).

```bash
# Generate message and signature (example using stellar-sdk CLI)
MSG=$(date +%s)
SIG=$(stellar-sdk sign --secret-key $ADMIN_SECRET_KEY --message "$MSG")

curl -s \
  -H "x-public-key: $ADMIN_PUBLIC_KEY" \
  -H "x-message: $MSG" \
  -H "x-signature: $SIG" \
  https://<backend-url>/api/ops/credentials/status | jq .
```

Expected healthy response:

```json
{
  "success": true,
  "data": {
    "database": {
      "configured": true,
      "source": "secrets_manager",
      "lastRefreshed": "2026-08-31T08:30:00.000Z"
    },
    "redis": {
      "configured": true,
      "source": "secrets_manager",
      "lastRefreshed": "2026-08-31T08:30:00.000Z",
      "urlRedacted": "rediss://***@redis-cluster.aws.internal:6379"
    },
    "timestamp": "2026-08-31T08:31:00.000Z"
  }
}
```

Key checks:

- `source` is `"secrets_manager"` (not `"env"`).
- `lastRefreshed` is within the last 4–5 minutes.

### 1d. Verify connectivity after rotation

```bash
# Health check — should return HTTP 200 "ok"
curl -f https://<backend-url>/health

# Readiness check — all subsystems should be ready
curl -s https://<backend-url>/readiness | jq .status
```

### 1e. Check CloudWatch Logs for rotation Lambda

```bash
# RDS rotation Lambda logs
aws logs tail /aws/lambda/<name_prefix>-rds-rotation --since 1h

# Redis rotation Lambda logs
aws logs tail /aws/lambda/<name_prefix>-redis-rotation --since 1h
```

Look for any `ERROR` entries.  A successful rotation ends with a `finishSecret` invocation that returns without error.

---

## 2. Manually trigger a rotation

> Use this to test the rotation flow on demand or after a suspected credential leak.

```bash
# Rotate RDS secret immediately
aws secretsmanager rotate-secret \
  --secret-id "<name_prefix>-db" \
  --rotate-immediately

# Rotate Redis secret immediately
aws secretsmanager rotate-secret \
  --secret-id "<name_prefix>-redis-auth-token" \
  --rotate-immediately
```

After triggering, wait ~2 minutes and then run the verification steps in §1 above.

---

## 3. Force the backend to pick up new credentials without a restart

The backend refreshes automatically within 4 minutes, but you can trigger an immediate refresh via the admin API:

```bash
MSG=$(date +%s)
SIG=$(stellar-sdk sign --secret-key $ADMIN_SECRET_KEY --message "$MSG")

curl -s -X POST \
  -H "x-public-key: $ADMIN_PUBLIC_KEY" \
  -H "x-message: $MSG" \
  -H "x-signature: $SIG" \
  https://<backend-url>/api/ops/credentials/refresh | jq .
```

Expected response:

```json
{
  "success": true,
  "data": {
    "database": { "refreshed": true, "poolMax": 10 },
    "redis": { "refreshed": true, "urlRedacted": "rediss://***@redis-cluster.aws.internal:6379" },
    "timestamp": "2026-08-31T08:35:00.000Z"
  }
}
```

Both `database.refreshed` and `redis.refreshed` must be `true`.

---

## 4. Rollback procedure

Use this if the rotation Lambda produces a bad credential and the application cannot connect.

### 4a. Restore a previous secret version

```bash
# List versions to find the AWSPREVIOUS version ID
aws secretsmanager list-secret-version-ids --secret-id "<name_prefix>-db"

# Restore AWSPREVIOUS → AWSCURRENT (roll back the secret)
PREV_VERSION=$(aws secretsmanager describe-secret \
  --secret-id "<name_prefix>-db" \
  --query 'VersionIdsToStages | keys(@)' \
  --output text \
  | tr '\t' '\n' \
  | while read v; do
      stage=$(aws secretsmanager describe-secret --secret-id "<name_prefix>-db" \
        --query "VersionIdsToStages.\"$v\"" --output text)
      if echo "$stage" | grep -q AWSPREVIOUS; then echo "$v"; fi
    done)

CURR_VERSION=$(aws secretsmanager describe-secret \
  --secret-id "<name_prefix>-db" \
  --query 'VersionIdsToStages | keys(@)[?contains(@, `"AWSCURRENT"`)] | [0]' \
  --output text)

aws secretsmanager update-secret-version-stage \
  --secret-id "<name_prefix>-db" \
  --version-stage AWSCURRENT \
  --move-to-version-id "$PREV_VERSION" \
  --remove-from-version-id "$CURR_VERSION"
```

> **Important for Redis:** If the Redis AUTH token was already set to the new value in ElastiCache, you must also call `modify-replication-group` with `--auth-token <old-token> --auth-token-update-strategy SET` to restore the old token in ElastiCache before restoring the secret.

### 4b. Force credential refresh on the backend

After the secret is rolled back, trigger an immediate backend refresh as shown in §3.

### 4c. Disable automatic rotation temporarily

```bash
# Pause rotation while you investigate
aws secretsmanager cancel-rotate-secret --secret-id "<name_prefix>-db"
aws secretsmanager cancel-rotate-secret --secret-id "<name_prefix>-redis-auth-token"
```

Re-enable rotation by calling `rotate-secret` once the root cause is resolved.

---

## 5. Alerting and monitoring

| Alarm | Metric | Threshold |
|-------|--------|-----------|
| Rotation Lambda errors | `AWS/Lambda` `Errors` for `<name_prefix>-rds-rotation` / `<name_prefix>-redis-rotation` | ≥ 1 in 5 minutes |
| Failed secret rotation | `AWS/SecretsManager` `RotationFailed` | ≥ 1 |
| Backend auth errors | Application logs: `[DB-POOL] Password authentication` | Alert on spike |
| Credential refresh failures | Application logs: `[CREDENTIALS] Background credential refresh failed` | Alert on repeated errors |

Configure these in CloudWatch Alarms and route alerts to your on-call SNS topic.

---

## 6. Reference — environment variables

| Variable | Purpose |
|----------|---------|
| `USE_AWS_SECRETS_MANAGER` | Set to `true` to enable Secrets Manager credential fetching |
| `DB_SECRET_ARN` | ARN of the RDS secret (also enables Secrets Manager when set) |
| `REDIS_SECRET_ARN` | ARN of the Redis AUTH token secret |
| `ADMIN_PUBLIC_KEYS` | Comma-separated Stellar public keys with access to ops endpoints |

---

## See also

- [AWS Secrets Manager rotation docs](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html)
- [ElastiCache in-place AUTH token rotation](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/auth.html#auth-modifyng-token)
- `backend/src/config/credentialManager.ts` – credential fetch and caching logic
- `backend/src/db/client.ts` – DB pool rotation tolerance
- `backend/src/queue/connection.ts` – Redis URL refresh
- `deployment/terraform/modules/rotation_lambda/` – Terraform rotation Lambda module
- `deployment/terraform/modules/rotation_lambda/redis_rotation_handler.py` – Redis rotation Lambda source
