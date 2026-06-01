# Operations handbook

How background jobs, queues, the contract indexer, and health checks fit together when you run or debug the backend locally or in Docker.

## Redis and queues

- **BullMQ** drives scheduled work: portfolio checks, rebalance jobs, analytics snapshots, and idempotency key cleanup.
- **Connection:** `REDIS_URL` (default `redis://localhost:6379`). If Redis is unreachable, `probeRedis()` reports unavailable and the HTTP API still starts; queue-backed features are degraded.
- **Scheduler:** When Redis is up, `startQueueScheduler()` (from `backend/src/queue/scheduler.ts`) registers repeatable cron jobs and enqueues one-off startup jobs (portfolio check, analytics snapshot, idempotency cleanup).
- **Queues:** Defined in `backend/src/queue/queues.js` (`portfolio-check`, `rebalance`, `analytics-snapshot`, `idempotency-cleanup`). Without Redis, queue getters return `null` and workers do not attach.

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

The indexer persists two keys in the `kv_store` table:

| Key | Purpose |
|-----|---------|
| `soroban_event_indexer.cursor` | Soroban RPC paging token for incremental event fetch |
| `soroban_event_indexer.latest_ledger` | Last known ledger sequence from RPC response |

The cursor is written only after a batch completes successfully. If the process crashes mid-batch the same events are re-fetched on restart; this is safe because rebalance history rows are keyed by UUID and duplicates do not affect correctness.

**Startup resume logic:**

1. Cursor in DB — resume from that paging token.
2. No cursor, but `latest_ledger` stored — start from `latest_ledger - 1`.
3. Neither exists (fresh DB) — bootstrap from `chain_tip - SOROBAN_EVENT_INDEXER_BOOTSTRAP_WINDOW` (default 500 ledgers).

### Inspecting indexer position

- **API:** `GET /api/v1/indexer/cursor` returns stored cursor, latest ledger, last successful/failed sync timestamps, and errors.
- **SQL:** `SELECT * FROM kv_store WHERE key LIKE 'soroban_event_indexer%'`

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

## Health vs readiness

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Plain `200` + `ok` — process up (root `index.ts`). |
| `GET /api/health` | JSON `{ status, timestamp }` — API router health. |
| `GET /ready` / `GET /readiness` | Deep probe: database, Redis/queues, worker runtime status, indexer, auto-rebalancer initialization (`backend/src/monitoring/readiness.ts`). Returns `503` when `status !== 'ready'`. |

Use `/health` for load balancer liveness. Use `/ready` before traffic shifts in environments that depend on Redis, workers, or the indexer.

## Health smoke test

`scripts/health-smoke.sh` probes the key operational surfaces (`/health`, `/api/health`, `/ready`, `/metrics`) and prints a pass/fail summary. Use it after a deploy or during triage against local, staging, or production.

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
|---------------------|-----------------------------------------------------------|
| `SMOKE_LOCAL_URL`   | Base URL for `local` (default `http://localhost:3001`)    |
| `SMOKE_STAGING_URL` | Base URL for `staging` (required when target is `staging`)|
| `SMOKE_PROD_URL`    | Base URL for `prod` (required when target is `prod`)      |
| `SMOKE_TIMEOUT`     | Per-request timeout in seconds (default `10`)             |

**Pass/fail semantics:**

- `liveness` (`/health`) and `api-health` (`/api/health`) are **required** — a failure exits non-zero.
- `readiness` (`/ready`) and `metrics` (`/metrics`) are **advisory** — they report a warning rather than failing the run, because readiness is legitimately `503` until Redis, workers, and the indexer are up (see the table above).

The script exits `0` when all required checks pass and `1` otherwise, so it can gate a deploy step or be run by hand without manual interpretation.

## Safe shutdown and restart

- **Process stop:** Stopping Node terminates open HTTP and WebSocket connections. BullMQ workers in the same process should be stopped with their `stop*Worker` helpers before exit if you add a worker host; repeatable jobs remain in Redis until removed via `stopQueueScheduler()`.
- **Redis restart:** Queues and repeatable job metadata live in Redis. After Redis comes back, restart the API so `probeRedis()` and `startQueueScheduler()` run again; workers must reconnect via `getConnectionOptions()`.
- **Database:** SQLite (`DB_PATH`) or PostgreSQL (`DATABASE_URL`) holds application data and indexer cursors. Deleting the DB resets consent and portfolios; indexer cursors reset to bootstrap behavior on next start.

## Supply chain artifacts

- The PR build workflow now emits three SBOM files: one each for `frontend`, `backend`, and `contracts`.
- The same workflow packages the frontend and backend bundles as tarballs and creates GitHub artifact attestations for those release outputs.
- Download the `build-and-supply-chain-artifacts` artifact from the workflow run when you need to inspect the exact files that were built.

### Verification

Use GitHub's attestation tooling to verify a downloaded artifact against the repository's published attestations. The workflow stores the attestation on the run; verification is a maintainer task, not a manual build step.

### Practical limits

This repository does not yet sign the live Docker images created by `deployment/docker-compose.yml`. The current control point is the CI build bundle and its SBOMs. If you move deployment to immutable image publishing later, add image-level attestations at that stage rather than trying to infer provenance from the compose file alone.

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

## Alerting and observability routing

To ensure high reliability, alerts in the system are explicitly labeled with `severity` and `subsystem` and routed to dedicated target receivers with varying timing profiles.

### Alert routing matrix

| Severity | Subsystem | Alert Name | Trigger Threshold | Primary Receiver | Notification Timing & Policy |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **critical** | `portfolio-engine` | `PortfolioRebalanceFailed` | Rebalance failed jobs >= 5 in queue | `pagerduty-critical` | Paged immediately. `group_wait: 10s`, `group_interval: 1m`, `repeat_interval: 1h` |
| **critical** | `api-gateway` | `BackendDown` | Scrape job `up == 0` for 2m | `pagerduty-critical` | Paged immediately. `group_wait: 10s`, `group_interval: 1m`, `repeat_interval: 1h` |
| **critical** | `api-gateway` | `BackendReadinessFailed` | `/readiness` returning non-2xx for 2m | `pagerduty-critical` | Paged immediately. `group_wait: 10s`, `group_interval: 1m`, `repeat_interval: 1h` |
| **critical** | `api-gateway` | `FrontendUptimeProbeFailed` | Frontend probe unavailable for 5m | `pagerduty-critical` | Paged immediately. `group_wait: 10s`, `group_interval: 1m`, `repeat_interval: 1h` |
| **critical** | `system` | `SystemReadinessDegraded` | Readiness report reports unhealthy for 2m | `pagerduty-critical` | Paged immediately. `group_wait: 10s`, `group_interval: 1m`, `repeat_interval: 1h` |
| **warning** | `api-gateway` | `Elevated5xxRate` | HTTP 5xx rate > 5% for 10m | `slack-warnings` | Async alert. `group_wait: 30s`, `group_interval: 5m`, `repeat_interval: 12h` |
| **warning** | `api-gateway` | `APILatencySpike` | 95th percentile request latency > 2.0s for 5m | `slack-warnings` | Async alert. `group_wait: 30s`, `group_interval: 5m`, `repeat_interval: 12h` |
| **warning** | `portfolio-engine` | `RebalanceQueueFailures` | Failed rebalance jobs > 0 for 5m | `slack-warnings` | Async alert. `group_wait: 30s`, `group_interval: 5m`, `repeat_interval: 12h` |
| **warning** | `portfolio-engine` | `ReflectorStalePricesDetected` | Price staleness detected in last 15m | `slack-warnings` | Async alert. `group_wait: 30s`, `group_interval: 5m`, `repeat_interval: 12h` |
| **warning** | `portfolio-engine` | `ReflectorFallbackUsageSpike` | Fallback price usage >= 5 in last 1h | `slack-warnings` | Async alert. `group_wait: 30s`, `group_interval: 5m`, `repeat_interval: 12h` |
| **info** | `api-gateway` | `ConfigurationReloaded` | Prometheus config reload success detected | `diagnostic-logs` | Logs only. `group_wait: 1m`, `group_interval: 10m`, `repeat_interval: 24h` |

---

### Configuration and routing validation

Operators can test the alert rule configurations and check routing tree compliance locally or in Docker.

#### 1. Validating file syntax locally
Use `promtool` and `amtool` to verify that both Prometheus rules and Alertmanager configurations are perfectly syntax-valid:

```bash
# Verify Prometheus Alert rules
docker run --rm -v "${PWD}/deployment/observability/prometheus:/etc/prometheus" prom/promtool check rules /etc/prometheus/alerts.yml

# Verify Alertmanager routing configuration
docker run --rm -v "${PWD}/deployment/observability/alertmanager:/etc/alertmanager" prom/alertmanager check-config /etc/alertmanager/alertmanager.yml
```

#### 2. Testing routing path via `amtool`
You can trace how an alert will be routed using `amtool`:

```bash
# Match a critical alert
docker run --rm -v "${PWD}/deployment/observability/alertmanager:/etc/alertmanager" --entrypoint amtool prom/alertmanager config routes show --alertname=PortfolioRebalanceFailed --severity=critical --subsystem=portfolio-engine

# Match a warning alert
docker run --rm -v "${PWD}/deployment/observability/alertmanager:/etc/alertmanager" --entrypoint amtool prom/alertmanager config routes show --alertname=APILatencySpike --severity=warning --subsystem=api-gateway
```

#### 3. Triggering mock alert payloads via `curl`
You can inject simulated alerts into Alertmanager's API to test the alert receivers in your development or staging environment:

**Trigger a critical portfolio engine alert:**
```bash
curl -H "Content-Type: application/json" -d '[
  {
    "labels": {
      "alertname": "PortfolioRebalanceFailed",
      "severity": "critical",
      "subsystem": "portfolio-engine",
      "service": "queue"
    },
    "annotations": {
      "summary": "Portfolio rebalancing has failed completely",
      "description": "Mocked validation payload for critical alert routing verification."
    }
  }
]' http://localhost:9093/api/v2/alerts
```

**Trigger a warning API latency alert:**
```bash
curl -H "Content-Type: application/json" -d '[
  {
    "labels": {
      "alertname": "APILatencySpike",
      "severity": "warning",
      "subsystem": "api-gateway",
      "service": "backend"
    },
    "annotations": {
      "summary": "API Gateway response latency spike detected",
      "description": "Mocked validation payload for warning alert routing verification."
    }
  }
]' http://localhost:9093/api/v2/alerts
```

**Trigger an info configuration reload alert:**
```bash
curl -H "Content-Type: application/json" -d '[
  {
    "labels": {
      "alertname": "ConfigurationReloaded",
      "severity": "info",
      "subsystem": "api-gateway",
      "service": "prometheus"
    },
    "annotations": {
      "summary": "Configuration reload successful",
      "description": "Mocked validation payload for info alert routing verification."
    }
  }
]' http://localhost:9093/api/v2/alerts
```

## Disaster recovery

For detailed, step-by-step procedures to handle incident response, outages, containment, rollbacks, database restoration, and validation across the smart contract, backend, and frontend stacks, refer to the [Disaster Recovery Runbook](DISASTER_RECOVERY.md).

## Related docs

- Contributor setup: [docs/CONTRIBUTING.md](CONTRIBUTING.md)
- OpenAPI source of truth: [backend/docs/openapi.md](../backend/docs/openapi.md)
- Disaster Recovery Runbook: [docs/DISASTER_RECOVERY.md](DISASTER_RECOVERY.md)
