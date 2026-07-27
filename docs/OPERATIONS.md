# Operations handbook

How background jobs, queues, the contract indexer, and health checks fit together when you run or debug the backend locally or in Docker.

## Queue Operations Monitoring

For comprehensive queue monitoring, dashboard guidance, and operational workflows:

- **Dashboard:** "Queue Operations & Worker Lag" in Grafana (`http://localhost:3003`) — real-time visualization of queue depth, worker lag, failure rates, and drain behavior
- **Health Check:** `node scripts/queue-health-check.mjs` — programmatic queue health validation for CI/CD pipelines and operational scripts
- **Workflows & Runbooks:** See [QUEUE_OPERATIONS_WORKFLOW.md](QUEUE_OPERATIONS_WORKFLOW.md) for scenario-based troubleshooting, pre-deployment validation, and incident response procedures

### Rebalance Queue Backlog Alert

The `RebalanceQueueBacklog` alert fires when the rebalance queue accumulates more than 50 waiting jobs for 10+ minutes. This typically indicates:

- Workers are stuck or have crashed
- Worker processes are scaled down relative to job arrival rate
- Redis connectivity issues preventing job processing

**Resolution steps:**

1. Check worker process status: `docker compose logs backend-worker` or equivalent
2. Verify Redis connectivity: `redis-cli ping` should return `PONG`
3. Check the queue-operations Grafana dashboard for worker lag metrics
4. If workers are healthy but backlog persists, consider scaling worker processes
5. Review recent deployments that may have introduced performance regressions

The alert clears automatically once the backlog drains below the threshold.

## Redis and queues

- **BullMQ** drives scheduled work: portfolio checks, rebalance jobs, analytics snapshots, and idempotency key cleanup.
- **Connection:** `REDIS_URL` (default `redis://localhost:6379`). If Redis is unreachable, `probeRedis()` reports unavailable and the HTTP API still starts; queue-backed features are degraded.
- **Scheduler:** When Redis is up, `startQueueScheduler()` (from `backend/src/queue/scheduler.ts`) registers repeatable cron jobs and enqueues one-off startup jobs (portfolio check, analytics snapshot, idempotency cleanup).
- **Queues:** Defined in `backend/src/queue/queues.js` (`portfolio-check`, `rebalance`, `analytics-snapshot`, `idempotency-cleanup`). Without Redis, queue getters return `null` and workers do not attach.
- **Metrics:** Backend exposes Prometheus metrics at `/metrics`: `stellar_portfolio_queue_jobs`, `stellar_portfolio_queue_worker_lag`, `stellar_portfolio_queue_drain_rate`, `stellar_portfolio_queue_failure_rate`

## Worker startup

- Worker implementations live under `backend/src/queue/workers/` (`portfolioCheckWorker`, `rebalanceWorker`, `analyticsSnapshotWorker`, `idempotencyCleanupWorker`). Each exposes `start*Worker` / `stop*Worker` and runtime status used by readiness and ops routes.
- **Important:** The default `npm run dev` / `npm start` entrypoint (`backend/src/index.ts`) registers the **scheduler** when Redis is available; it does **not** automatically spawn BullMQ worker processes. For full queue processing in development you need a process that calls the worker starters (or a dedicated worker entrypoint your deployment provides). Until workers run, jobs accumulate in Redis and `/ready` may report workers as not ready.
- **Docker Compose:** The `backend` service runs `npm start` only. Ensure `REDIS_URL` points at the `redis` service (e.g. `redis://redis:6379`) if you expect queues to function. The optional `observability` profile runs another Node process on a separate port for observability stacks—see `deployment/docker-compose.yml`. Note that the Docker Compose configuration includes predefined resource limits (CPU and memory) for each service to guarantee reproducibility in local and preview environments. You can adjust these in a `docker-compose.override.yml` if necessary.

## Contract event indexer

- **Code:** `backend/src/services/contractEventIndexer.ts`.
- **Enable:** Set `STELLAR_CONTRACT_ADDRESS` or `CONTRACT_ADDRESS` and a Soroban RPC URL (`SOROBAN_RPC_URL`, `STELLAR_RPC_URL`, or network default). Without both, the indexer stays disabled.
- **Manual sync:** Admin/API routes can trigger `contractEventIndexerService.syncOnce()` for a forced pull outside the poll interval.
- **Readiness:** `/ready` marks the indexer `disabled` when not configured, or `not_ready` until a successful startup sync completes (`lastSuccessfulRunAt` set, no `lastError`).

### Durable cursor

The indexer persists its resume state in the `contract_event_indexer_state` table. The `kv_store` keys remain populated as legacy compatibility mirrors only.

| Key                                   | Purpose                                              |
| ------------------------------------- | ---------------------------------------------------- |
| `soroban_event_indexer.cursor`        | Soroban RPC paging token for incremental event fetch |
| `soroban_event_indexer.latest_ledger` | Last known ledger sequence from RPC response         |

The cursor is written after each fetched page is processed and again when a sync succeeds. If the process crashes mid-page, that page can be re-fetched on restart; on-chain rebalance history rows store `on_chain_paging_token` with a unique index so replayed events are treated idempotently instead of duplicating history.

**Startup resume logic:**

1. Cursor in DB — resume from that paging token.
2. No cursor, but `latest_ledger` stored — start from `latest_ledger - 1`.
3. Neither exists (fresh DB) — bootstrap from `chain_tip - SOROBAN_EVENT_INDEXER_BOOTSTRAP_WINDOW` (default 500 ledgers).

### Inspecting indexer position

- **API:** `GET /api/v1/indexer/cursor` returns stored cursor, latest ledger, last successful/failed sync timestamps, and errors.
- **SQL:** `SELECT * FROM contract_event_indexer_state WHERE name = 'soroban_event_indexer'` (legacy mirrors are also visible with `SELECT * FROM kv_store WHERE key LIKE 'soroban_event_indexer%'`).

### Re-sync and backfill

Use the CLI script to reset the cursor and replay on-chain history:

```bash
cd backend
npx tsx scripts/reindex-events.ts --full                   # full reindex from bootstrap window
npx tsx scripts/reindex-events.ts --from-ledger 12345      # backfill from a specific ledger
npx tsx scripts/reindex-events.ts --full --dry-run         # preview without writing to DB
```

The script requires `ADMIN_REINDEX_KEY` to be set (matches the env var on the server) to prevent accidental runs. See `backend/scripts/reindex-events.ts` for details.

### RPC resilience

The indexer uses bounded exponential backoff when the Soroban RPC is unreachable. It tracks last successful sync time, last failed sync time, and a ring buffer of recent error summaries. These are exposed through the `/api/v1/indexer/cursor` and `/ready` endpoints so operators can tell whether the indexer is healthy, catching up, or stuck.

## Notification delivery backoff

Email and webhook providers use explicit backoff policies from `backend/src/config/notificationDeliveryConfig.ts`, validated at startup and summarized in the startup log under `notificationDelivery`.

- **Logs:** `notification_logs` rows include `attempt_number` and `backoff_delay_ms` when a retry is scheduled or a delivery completes.
- **Tuning:** Increase `EMAIL_MAX_ATTEMPTS` or `WEBHOOK_RETRY_COUNT` for flaky SMTP or webhook endpoints; raise `*_MAX_BACKOFF_MS` to spread retries during outages.
- **Failure triage:** Search logs for `Notification delivery failed; scheduling backoff retry` or `Notification delivery exhausted retries`. Query recent rows: `SELECT * FROM notification_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`.

See [NOTIFICATIONS.md](./NOTIFICATIONS.md) for the full environment variable table.

## Health vs readiness

| Endpoint                        | Purpose                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /health`                   | Plain `200` + `ok` — process up (root `index.ts`).                                                                                                                                   |
| `GET /api/health`               | JSON `{ status, timestamp }` — API router health.                                                                                                                                    |
| `GET /ready` / `GET /readiness` | Deep probe: database, Redis/queues, worker runtime status, indexer, auto-rebalancer initialization (`backend/src/monitoring/readiness.ts`). Returns `503` when `status !== 'ready'`. |

Use `/health` for load balancer liveness. Use `/ready` before traffic shifts in environments that depend on Redis, workers, or the indexer.

## Health smoke test

`scripts/health-smoke.sh` probes the key operational surfaces (`/health`, `/api/health`, `/ready`, `/`, `/api-docs`, `/metrics`) and prints a pass/fail summary. Use it after a deploy or during triage against local, staging, or production.

```bash
# From the repository root
npm run smoke                 # probe local (default http://localhost:3001)
npm run smoke -- staging      # probe SMOKE_STAGING_URL
npm run smoke -- prod         # probe SMOKE_PROD_URL
npm run smoke -- https://api.example.com   # probe an explicit base URL

# Or call the script directly
scripts/health-smoke.sh local
```

Configure non-local targets and tuning via environment variables:

| Variable            | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| `SMOKE_LOCAL_URL`   | Base URL for `local` (default `http://localhost:3001`)     |
| `SMOKE_STAGING_URL` | Base URL for `staging` (required when target is `staging`) |
| `SMOKE_PROD_URL`    | Base URL for `prod` (required when target is `prod`)       |
| `SMOKE_TIMEOUT`     | Per-request timeout in seconds (default `10`)              |

**Pass/fail semantics:**

- `liveness` (`/health`) and `api-health` (`/api/health`) are **required** — a failure exits non-zero.
- `readiness` (`/ready`) and `metrics` (`/metrics`) are **advisory** — they report a warning rather than failing the run, because readiness is legitimately `503` until Redis, workers, and the indexer are up (see the table above).

The script exits `0` when all required checks pass and `1` otherwise, so it can gate a deploy step or be run by hand without manual interpretation.

## Safe shutdown and restart

- **Process stop:** Stopping Node terminates open HTTP and WebSocket connections. BullMQ workers in the same process should be stopped with their `stop*Worker` helpers before exit if you add a worker host; repeatable jobs remain in Redis until removed via `stopQueueScheduler()`.
- **Redis restart:** Queues and repeatable job metadata live in Redis. After Redis comes back, restart the API so `probeRedis()` and `startQueueScheduler()` run again; workers must reconnect via `getConnectionOptions()`.
- **Database:** SQLite (`DB_PATH`) or PostgreSQL (`DATABASE_URL`) holds application data and indexer cursors. Deleting the DB resets consent and portfolios; indexer cursors reset to bootstrap behavior on next start.

## Supply chain artifacts

- The dedicated [`.github/workflows/sbom.yml`](../.github/workflows/sbom.yml) workflow generates CycloneDX 1.5 SBOM JSON for every tracked package — `frontend`, `backend`, and `contracts` — and uploads them as GitHub workflow artifacts named `sbom-{frontend,backend,contracts}` on every PR, push to `main`, and GitHub release (via `release: published`).
- The build workflow also embeds the frontend + backend SBOMs in the `build-and-supply-chain-artifacts` bundle, alongside the bundle tarballs and attestations.
- Generate the same artifacts locally with `npm run sbom` (or the per-ecosystem helpers `sbom:contracts`, `sbom:backend`, `sbom:frontend`); output path is `security/sbom/{ecosystem}.cdx.json`.
- The raw SBOMs follow the CycloneDX 1.5 JSON schema (NTIA minimum fields). See [`security/SBOM.md`](../security/SBOM.md) for consumer recipes (Dependency-Track, Grype, Snyk, `bom-cli`).

### Verification

Use GitHub's attestation tooling to verify a downloaded artifact against the repository's published attestations; the SBOM artifacts are workflow-only (no attestation needed). Both flows ship on the same set of workflow files so a security investigator can correlate contract hash → contract SBOM → contract attestations using the run's git SHA.

### Practical limits

This repository does not yet sign the live Docker images created by `deployment/docker-compose.yml`. The current control point is the CI build bundle and its SBOMs. If you move deployment to immutable image publishing later, add image-level attestations at that stage rather than trying to infer provenance from the compose file alone.

## Sentry release tagging

The deploy workflow now derives Sentry metadata automatically from the current git SHA and target environment before any image build starts.

- `scripts/sentry-metadata.mjs` is the single source of truth for the release/environment values.
- `npm run sentry:metadata -- --deployment production` prints the exact env lines that CI injects.
- `npm run validate:sentry-metadata` fails fast if the backend and frontend Sentry values drift apart or if the release no longer matches the current commit.

In practice, this means the backend and frontend Sentry events can be traced back to one immutable build identifier and one deployment tier without manual bookkeeping.

### Release checklist

The release checklist template lives in [docs/RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md). Use it before cutting a release that touches contract, backend, or frontend delivery.

## JWT signing secret rotation

The backend supports a dual-secret validation window so access tokens signed with the previous secret remain valid for a controlled grace period.

### Environment variables

- `JWT_SECRET`: active signing secret (required for issuing new access/refresh tokens).
- `JWT_PREVIOUS_SECRET`: prior signing secret used before rotation.
- `JWT_PREVIOUS_SECRET_GRACE_UNTIL`: ISO-8601 UTC timestamp. Old-secret access tokens are accepted only until this time.

### Rotation runbook

1. Generate a new `JWT_SECRET` value (minimum 32 chars).
2. Set `JWT_PREVIOUS_SECRET` to the currently active secret.
3. Set `JWT_PREVIOUS_SECRET_GRACE_UNTIL` to a future UTC timestamp that covers your rollout window (for example, 30-60 minutes).
4. Deploy all API instances with all three variables (`JWT_SECRET`, `JWT_PREVIOUS_SECRET`, `JWT_PREVIOUS_SECRET_GRACE_UNTIL`) at the same time.
5. Verify protected routes accept newly issued tokens and still accept tokens signed before deployment during the grace period.
6. After the grace period has ended, remove `JWT_PREVIOUS_SECRET` and `JWT_PREVIOUS_SECRET_GRACE_UNTIL` from the environment.
7. Perform a final deploy with only the new `JWT_SECRET` configured.

### Expected behavior

- Tokens signed with `JWT_SECRET` always validate normally.
- Tokens signed with `JWT_PREVIOUS_SECRET` validate only while `Date.now() <= JWT_PREVIOUS_SECRET_GRACE_UNTIL`.
- After grace expiry, old-secret tokens are rejected with `401`.

## Database and Redis credential rotation (AWS Secrets Manager)

The deployment infrastructure uses AWS Secrets Manager automatic rotation for both RDS PostgreSQL database master credentials (`manage_master_user_password = true`) and Redis ElastiCache AUTH tokens. By default, secrets are configured in Terraform to rotate automatically every 30 days (`secret_rotation_days = 30`).

### Dynamic credential resolution & rotation tolerance

The backend service uses `CredentialManager` (`backend/src/config/credentialManager.ts`) to read database and Redis credentials dynamically from AWS Secrets Manager or environment variables rather than caching static credentials indefinitely.

When a scheduled or manual rotation occurs:
- **Database (`backend/src/db/client.ts`):** If a PostgreSQL connection or query fails with an authentication error (such as error code `28P01` or `password authentication failed`), `query()` detects the rotation event, automatically invokes `refreshDbPool()` to clear cached credentials and recreate the connection pool, and retries the query without failing the request.
- **Redis (`backend/src/queue/connection.ts`):** Redis clients and BullMQ workers resolve connection options dynamically via `getRedisUrl()`. When an authentication error occurs (`NOAUTH`, `WRONGPASS`), `refreshRedisCredentials()` is invoked to re-read the rotated token and reconnect automatically.

Backend services continue operating without manual intervention across rotation events.

### Runbook: Verifying successful rotation

#### 1. Check AWS Secrets Manager rotation status
Use the AWS CLI to confirm that automatic rotation is enabled and check the last rotated timestamp:
```bash
# Verify RDS database secret rotation status
aws secretsmanager describe-secret --secret-id <db_secret_arn> \
  --query '{RotationEnabled:RotationEnabled,LastRotatedDate:LastRotatedDate,RotationRules:RotationRules}'

# Verify Redis AUTH token secret rotation status
aws secretsmanager describe-secret --secret-id <redis_secret_arn> \
  --query '{RotationEnabled:RotationEnabled,LastRotatedDate:LastRotatedDate,RotationRules:RotationRules}'
```

#### 2. Perform an on-demand rotation test (Drill)
To verify rotation without waiting for the scheduled interval:
```bash
# Trigger immediate rotation for RDS database credentials
aws secretsmanager rotate-secret --secret-id <db_secret_arn>

# Trigger immediate rotation for Redis AUTH token
aws secretsmanager rotate-secret --secret-id <redis_secret_arn>
```

#### 3. Verify zero-downtime backend tolerance
Inspect backend application logs for automatic credential refresh events:
```bash
# Check logs for automatic DB pool refresh after password change
docker compose logs --tail=100 backend | grep -E "DB-POOL.*Refreshing|QUEUE.*Refreshing|CREDENTIALS"
```
Expected log entries:
- `[DB-POOL] Password authentication or connection failed — possible secret rotation event detected. Refreshing credentials and DB pool...`
- `[DB-POOL] Refreshing database credentials and resetting connection pool to tolerate rotation...`
- `[QUEUE] Refreshing Redis credentials to tolerate rotation...`

#### 4. Verify rotation status via administrative API
Query the backend administrative endpoints to verify the credential manager state:
```bash
# Inspect current credential status and lastRefreshed timestamps
curl -X GET https://<backend_host>/api/ops/credentials/status \
  -H "X-Public-Key: <admin_public_key>" \
  -H "X-Message: <timestamp>" \
  -H "X-Signature: <signature>"

# Manually trigger a proactive credential reload across DB and Redis pools
curl -X POST https://<backend_host>/api/ops/credentials/refresh \
  -H "X-Public-Key: <admin_public_key>" \
  -H "X-Message: <timestamp>" \
  -H "X-Signature: <signature>"
```
The response confirms `refreshed: true` for both database and redis subsystems.

#### 5. Verify direct database and Redis connectivity with rotated credentials
Retrieve the rotated secret value from Secrets Manager and test connectivity:
```bash
# Get current DB secret and connect via psql
SECRET_JSON=$(aws secretsmanager get-secret-value --secret-id <db_secret_arn> --query SecretString --output text)
DB_PASS=$(echo $SECRET_JSON | jq -r .password)
DB_HOST=$(echo $SECRET_JSON | jq -r .host)
PGPASSWORD=$DB_PASS psql -h $DB_HOST -U dbadmin -d stellar_portfolio -c "SELECT 1;"

# Get current Redis AUTH token and test via redis-cli
REDIS_TOKEN=$(aws secretsmanager get-secret-value --secret-id <redis_secret_arn> --query SecretString --output text | jq -r .auth_token)
redis-cli -h <redis_endpoint> -p 6379 -a "$REDIS_TOKEN" PING
```

### Runbook: Rollback procedure if needed

If an automatic rotation fails or causes persistent authentication failures, follow these steps to roll back to the previous credential version:

#### 1. Identify a failed rotation event
Check AWS CloudWatch Logs or AWS Secrets Manager console for error messages on the rotation Lambda function, or monitor backend alerts for persistent `503 Service Unavailable` or database authentication loops.

#### 2. Identify the previous secret version in AWS Secrets Manager
List version IDs for the secret to find the stage labeled `AWSPREVIOUS`:
```bash
aws secretsmanager list-secret-version-ids --secret-id <secret_arn>
```

#### 3. Roll back the secret version stage
Move the `AWSCURRENT` staging label back to the previous version ID:
```bash
aws secretsmanager update-secret-version-stage --secret-id <secret_arn> \
  --version-stage AWSCURRENT \
  --move-to-version-id <previous-version-id>
```

#### 4. Revert RDS or ElastiCache password if out-of-sync
If AWS Secrets Manager is reverted but the underlying RDS or ElastiCache instance was already modified:
```bash
# Retrieve the restored password from AWSCURRENT
REVERTED_PASS=$(aws secretsmanager get-secret-value --secret-id <db_secret_arn> --query SecretString --output text | jq -r .password)

# Apply the reverted password directly to the RDS instance
aws rds modify-db-instance \
  --db-instance-identifier <db_instance_identifier> \
  --master-user-password "$REVERTED_PASS" \
  --apply-immediately

# For ElastiCache Redis replication group
REVERTED_TOKEN=$(aws secretsmanager get-secret-value --secret-id <redis_secret_arn> --query SecretString --output text | jq -r .auth_token)
aws elasticache modify-replication-group \
  --replication-group-id <redis_cluster_id> \
  --auth-token "$REVERTED_TOKEN" \
  --auth-token-update-strategy SET \
  --apply-immediately
```

#### 5. Force immediate credential reload on backend instances
Once the secret is reverted, invoke the administrative refresh endpoint so all backend tasks immediately re-read the reverted credentials without waiting for cache expiration:
```bash
curl -X POST https://<backend_host>/api/ops/credentials/refresh \
  -H "X-Public-Key: <admin_public_key>" \
  -H "X-Message: <timestamp>" \
  -H "X-Signature: <signature>"
```
Or force a rolling restart of the ECS service:
```bash
aws ecs update-service --cluster <ecs_cluster_name> --service <ecs_service_name> --force-new-deployment
```

## Database Backups and Restores

The application supports two database backends: SQLite (for development) and PostgreSQL (for production). Both have automated backup and restore capabilities.

### Backup Operations

#### SQLite Backups

Create a backup of the SQLite database:
```bash
cd backend
npm run db:backup
```

By default, backups are stored in `backend/data/backups/` with a timestamped filename:
`portfolio-backup-YYYY-MM-DDTHH-MM-SS-SSS.db`

You can specify a custom backup path:
```bash
npm run db:backup -- --path ./custom/path/my-backup.db
```

#### PostgreSQL Backups

Create a PostgreSQL backup (requires `pg_dump`):
```bash
cd backend
npm run db:backup
```

Backups are stored in `backend/data/backups/` as SQL dumps. Custom output path:
```bash
npm run db:backup -- --output ./custom/path/backup.sql
```

PostgreSQL backup uses `DATABASE_URL` or `PG*` environment variables (PGHOST, PGPORT, PGUSER, PGDATABASE, PGPASSWORD) to connect.

### Restore Operations

#### SQLite Restores

Restore from a SQLite backup:
```bash
cd backend
npm run db:restore ./path/to/your-backup.db
```

**Important**: Stop the backend server before restoring. The restore process will close and reopen the database connection.

#### PostgreSQL Restores

Restore from a PostgreSQL backup (requires `psql`):
```bash
cd backend
npm run db:restore ./path/to/your-backup.sql
```

### Backup Drills

Practice these restore drills to ensure your backup process is reliable:

#### Drill 1: Local SQLite Backup & Restore

1. **Create test data**:
   ```bash
   cd backend
   # Start the backend and create a test portfolio
   npm run dev
   # Create a portfolio via API or UI
   ```

2. **Create backup**:
   ```bash
   npm run db:backup
   ```
   Note the backup file path.

3. **Modify data**:
   - Delete or modify the test portfolio
   - Verify the change is in the database

4. **Restore backup**:
   ```bash
   npm run db:restore ./path/to/your-backup.db
   ```

5. **Verify restore**:
   - Check that the original portfolio is restored correctly

#### Drill 2: PostgreSQL Backup & Restore (Production-like)

1. **Set up PostgreSQL locally**:
   ```bash
   # Using Docker
   docker run --name stellar-pg -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=stellar -p 5432:5432 -d postgres
   ```

2. **Configure environment**:
   ```bash
   export DATABASE_URL="postgresql://postgres:secret@localhost:5432/stellar"
   ```

3. **Run migrations**:
   ```bash
   cd backend
   npm run db:migrate
   ```

4. **Create test data**:
   - Use the API to create test portfolios and events

5. **Backup**:
   ```bash
   npm run db:backup
   ```

6. **Modify data**:
   - Make changes to the database

7. **Restore**:
   ```bash
   npm run db:restore ./path/to/pg-backup.sql
   ```

8. **Verify**:
   - Confirm the original data is restored

### Failure Handling

- The scripts exit with non-zero code on failure, making them suitable for CI/CD pipelines
- SQLite restore includes safety checks and attempts to reopen the original database if restore fails
- PostgreSQL restore requires proper permissions and `psql`/`pg_dump` in PATH

### CI/CD Integration

Add backup verification to your CI pipeline:
```yaml
# Example GitHub Actions step
- name: Test backup/restore
  run: |
    cd backend
    npm run db:backup
    # Verify backup file exists
    ls -la data/backups/
```

## Disaster recovery

For detailed, step-by-step procedures to handle incident response, outages, containment, rollbacks, database restoration, and validation across the smart contract, backend, and frontend stacks, refer to the [Disaster Recovery Runbook](DISASTER_RECOVERY.md).

## Circuit-breaker manual-reset runbook

The `RiskManagementService` maintains an in-memory circuit breaker for every tracked asset (`XLM`, `BTC`, `ETH`, `USDC`, and any assets added via the admin API). A breaker **trips** when an asset's tick-over-tick price change exceeds **20 %** (the `CIRCUIT_BREAKER_THRESHOLD`). While tripped, `shouldAllowRebalance()` returns `allowed: false` with reason code `CIRCUIT_BREAKER_ACTIVE`, blocking all automatic and manual rebalance operations for any portfolio that holds the affected asset.

Tripped breakers auto-recover after **5 minutes** (`CIRCUIT_BREAKER_COOLDOWN`). The steps below are for situations where you need to reset before that window expires, or where you need to confirm the system is healthy after an incident.

### 1. Diagnose – confirm the breaker is tripped

**Public status endpoint (no auth):**

```bash
curl -s https://<API_HOST>/api/system/status | jq '.data.riskManagement'
```

A tripped breaker looks like:

```json
{
  "circuitBreakers": {
    "BTC": {
      "isTriggered": true,
      "triggerReason": "22.3% price movement",
      "cooldownUntil": 1722080760000,
      "triggeredAssets": ["BTC"]
    }
  },
  "enabled": true,
  "alertsActive": true
}
```

`isTriggered: true` with a `cooldownUntil` value in the future confirms the breaker is active. Convert the Unix millisecond timestamp to determine how much cooldown remains:

```bash
node -e "console.log(new Date(1722080760000).toISOString())"
```

**Per-portfolio risk check:**

```bash
curl -s https://<API_HOST>/api/risk/check/<PORTFOLIO_ID> | jq '{allowed, reason, reasonCode}'
```

If the response is `"reasonCode": "CIRCUIT_BREAKER_ACTIVE"`, rebalancing is blocked for that portfolio.

**Per-portfolio detailed circuit-breaker status:**

```bash
curl -s https://<API_HOST>/api/risk/metrics/<PORTFOLIO_ID> | jq '.data.circuitBreakers'
```

This returns the per-asset breaker map, including `triggerReason` and the precise `cooldownUntil` timestamp.

---

### 2. Decide – reset manually or wait?

| Situation | Recommended action |
|-----------|-------------------|
| Cooldown expires in < 3 minutes | **Wait.** Auto-recovery will fire; no operator action needed. |
| Flash-crash or data anomaly confirmed as false alarm | **Reset manually.** Prices have stabilised and the trigger was a bad tick or feed glitch. |
| Market still highly volatile (> 15 % EWMA vol) | **Wait or investigate further.** Resetting into continued volatility will likely re-trip the breaker immediately. |
| Cooldown has expired but `isTriggered` is still `true` in status | Call `GET /api/system/status` again — `getCircuitBreakerStatus()` performs the expiry check lazily on each read. If the flag does not clear, restart the API process (see Safe shutdown and restart below). |
| Incident requires immediate production rebalancing | Follow the manual-reset steps below, then monitor `/api/risk/check/:portfolioId` continuously after the reset. |

---

### 3. Perform the manual reset

The admin endpoint accepts an `X-Admin-Key` header (value of the `ADMIN_API_KEY` environment variable) and optionally a specific asset to reset. Omitting `asset` resets **all** tripped breakers.

**Reset a single asset (e.g. BTC):**

```bash
curl -X POST https://<API_HOST>/api/admin/circuit-breaker/reset \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: <ADMIN_API_KEY>" \
  -d '{"asset": "BTC"}'
```

**Reset all assets at once:**

```bash
curl -X POST https://<API_HOST>/api/admin/circuit-breaker/reset \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: <ADMIN_API_KEY>" \
  -d '{}'
```

Expected success response (`200 OK`):

```json
{
  "success": true,
  "data": {
    "reset": ["BTC"],
    "message": "Circuit breaker(s) reset successfully"
  }
}
```

> **Note:** The `RiskManagementService` instance is in-process and in-memory. If the API runs as multiple instances behind a load balancer, send the reset request to **every instance** (or use a sticky session / internal broadcast mechanism). After any process restart the breaker state is cleared automatically.

---

### 4. Post-reset confirmation checklist

Run through the following checks after performing a reset to confirm the system has returned to normal operation:

- [ ] **Breaker cleared** – `GET /api/system/status` returns `alertsActive: false` and `isTriggered: false` for the affected asset(s).
- [ ] **Risk check passes** – `GET /api/risk/check/<PORTFOLIO_ID>` returns `"reasonCode": "CIRCUIT_BREAKER_ACTIVE"` no longer; `allowed: true` (assuming no other blocks are active).
- [ ] **Price feed is live** – `GET /api/system/status` shows `"priceFeeds": true` under `services`. Stale or absent prices will re-trip the breaker on the next price tick if volatility is still high.
- [ ] **Auto-rebalancer running** – `GET /api/system/status` → `autoRebalancer.status.isRunning: true`. If the auto-rebalancer paused due to the circuit-breaker event, restart it:
  ```bash
  curl -X POST https://<API_HOST>/api/auto-rebalancer/start \
    -H "X-Admin-Key: <ADMIN_API_KEY>"
  ```
- [ ] **No repeat trips** – Monitor `GET /api/system/status` for 5–10 minutes after the reset. If the breaker re-trips immediately, the underlying market condition has not stabilised; **do not keep resetting manually** — investigate the price feed or wait for conditions to calm.
- [ ] **Notification delivered** – If circuit-breaker notifications are enabled (`event_circuit_breaker` preference), confirm users received the event-cleared or rebalancing-resumed notification (check `GET /api/notifications` for recent entries).
- [ ] **Audit log entry** – Confirm the admin action is reflected in application logs (search for `circuit-breaker reset` at `INFO` level).

---

## Related docs

- Contributor setup: [docs/CONTRIBUTING.md](CONTRIBUTING.md)
- OpenAPI source of truth: [backend/docs/openapi.md](../backend/docs/openapi.md)
- Disaster Recovery Runbook: [docs/DISASTER_RECOVERY.md](DISASTER_RECOVERY.md)
