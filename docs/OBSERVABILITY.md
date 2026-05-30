# Observability

This repository now includes a baseline observability stack for production debugging and alerting:

- Sentry for frontend and backend error tracking
- New Relic for optional backend APM
- Prometheus for metrics scraping
- Grafana for dashboards
- Loki + Promtail for centralized log aggregation
- Blackbox Exporter for uptime probes
- Alertmanager for alert routing

## Backend

Backend observability is enabled with environment variables in [backend/.env.example](C:\Users\HP\Documents\students\drips\stellar-portfolio-rebalancer\backend.env.example).

- `SENTRY_ENABLED=true` and `SENTRY_DSN=...` send unhandled backend exceptions to Sentry.
- `NEW_RELIC_ENABLED=true` and `NEW_RELIC_LICENSE_KEY=...` enable backend APM.
- `METRICS_ENABLED=true` exposes Prometheus metrics at `GET /metrics`.

The backend publishes:

- request count and latency metrics
- in-flight request gauge
- readiness status gauge
- BullMQ queue depth metrics
- structured JSON logs for Loki ingestion

## Frontend

Frontend Sentry is configured at build time through Vite env vars in [frontend/.env.example](C:\Users\HP\Documents\students\drips\stellar-portfolio-rebalancer\frontend.env.example).

- `VITE_SENTRY_ENABLED=true`
- `VITE_SENTRY_DSN=...`

An application error boundary captures render failures and reports them to Sentry.

## Running The Stack

Start the app plus the monitoring stack:

```bash
docker compose -f deployment/docker-compose.yml --profile observability up --build
```

Main endpoints:

- App: `http://localhost:3000`
- Backend: `http://localhost:3001`
- Prometheus: `http://localhost:9090`
- Alertmanager: `http://localhost:9093`
- Grafana: `http://localhost:3003`
- Loki: `http://localhost:3100`

## Dashboards And Alerts

Grafana provisions:

- a Prometheus datasource
- a Loki datasource
- the `Portfolio Observability Overview` dashboard
- the `Queue Operations & Worker Lag` dashboard (for operational queue monitoring)

Prometheus alerts are preconfigured for:

- backend metrics endpoint down
- backend readiness failures
- frontend uptime failures
- elevated backend 5xx rate
- failed rebalance queue jobs
- stale Reflector price rows observed in the last 15 minutes
- excessive fallback price usage over the last hour

The backend exports dedicated price-quality metrics:

- `stellar_portfolio_price_feed_resolutions_total`
- `stellar_portfolio_reflector_stale_prices_total`
- `stellar_portfolio_reflector_fallback_usage_total`

Alertmanager ships alerts to `http://host.docker.internal:5001/alerts` by default. Replace that receiver with your Slack, PagerDuty, Opsgenie, or webhook destination before production rollout.

### Queue Operations Dashboard

The **Queue Operations & Worker Lag** dashboard (`queue-operations`) provides real-time visibility into background job processing health. It is designed to help maintainers understand queue depth, worker capacity, and failure patterns.

**Key Panels:**

1. **Queue Waiting Jobs** – Jobs queued but not yet processing. High values indicate workers are not keeping up with demand.
2. **Active Workers (Processing)** – Number of workers actively executing jobs per queue. Zero workers with waiting jobs indicates a worker failure or scale issue.
3. **Failed Jobs** – Count of failed jobs per queue. Rising trend indicates systematic issues.
4. **Delayed Jobs (Retrying)** – Jobs scheduled for retry due to transient failures. Normal under load; sustained high values indicate persistent issues.
5. **Completed Jobs (Drain Rate)** – Successfully processed jobs. The slope of this line shows how fast queues are being drained.
6. **Total Queue Backlog** – Sum of waiting, delayed, and failed jobs. The primary metric for operational health; should trend toward zero.
7. **Worker Lag Ratio** – Ratio of (waiting + delayed) jobs to active workers. Values > 5 indicate backlog accumulation; > 10 indicates critical lag.
8. **Queue Composition by State** – Stacked view of all job states over time. Helps identify when failures or delays spike.
9. **Queue Worker Logs** – Real-time logs from queue workers for troubleshooting.
10. **Error and Failure Logs** – Error-level logs for quick diagnosis of systematic issues.

**Time Range and Refresh:**

- Default view: last 1 hour of data
- Auto-refresh: 10 seconds (configurable)
- Suitable for live incident response and post-incident analysis

**Interpreting Queue Health:**

- **Healthy**: Waiting queue empty, active workers > 0, low failure rate, drain rate > 0.
- **Warning**: Small backlog (1–50 jobs), worker lag 5–10, failure rate 10–30%.
- **Critical**: Large backlog (>100 jobs), worker lag >10, failure rate >30%, no active workers, or persistent delays.

See [Queue Metrics Reference](#queue-metrics-reference) for metric definitions.

## Queue Metrics Reference

The backend exposes the following Prometheus metrics for queue monitoring:

| Metric                                 | Labels           | Description                                                                                |
| -------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| `stellar_portfolio_queue_jobs`         | `queue`, `state` | Gauge: current job count by queue and state (waiting, active, completed, failed, delayed)  |
| `stellar_portfolio_queue_worker_lag`   | `queue`          | Gauge: worker lag ratio = (waiting + delayed) / (active + 1); high values indicate backlog |
| `stellar_portfolio_queue_drain_rate`   | `queue`          | Gauge: ratio of completed to total processed jobs; 1.0 = all jobs succeed, 0.5 = 50% fail  |
| `stellar_portfolio_queue_failure_rate` | `queue`          | Gauge: ratio of failed to total processed jobs; high values indicate systematic failures   |

**Queue Names:**

- `portfolio-check` – Periodic portfolio analysis and rebalance eligibility checks (every 30 min)
- `rebalance` – Rebalancing execution (manual or automatic)
- `analytics-snapshot` – Portfolio snapshot collection for historical analysis (every 60 min)
- `idempotency-cleanup` – Cleanup of stale idempotency keys (every 60 min)

### Queue Health Check Script

For automated operational workflows and CI/CD validation, use the queue health check script:

```bash
node scripts/queue-health-check.mjs
```

**Exit Codes:**

| Code | Status     | Meaning                                                                                    |
| ---- | ---------- | ------------------------------------------------------------------------------------------ |
| 0    | ✓ Healthy  | All queues within normal thresholds                                                        |
| 1    | ⚠ Warning  | At least one queue in warning state (e.g., elevated backlog or lag)                        |
| 2    | ✗ Critical | At least one queue in critical state (e.g., backlog exceeds threshold or all workers dead) |
| 3    | ⚠ Error    | Cannot connect to backend or parse metrics                                                 |

**Configuration via Environment Variables:**

```bash
# Custom backend URL (default: http://localhost:3001)
BACKEND_URL=http://production-backend:3001 node scripts/queue-health-check.mjs

# Custom timeouts and thresholds (default values shown)
QUEUE_CRITICAL_BACKLOG=100 \
QUEUE_WARNING_BACKLOG=50 \
QUEUE_CRITICAL_LAG=10 \
QUEUE_WARNING_LAG=5 \
QUEUE_CRITICAL_FAILURE=0.3 \
QUEUE_WARNING_FAILURE=0.1 \
HEALTH_CHECK_TIMEOUT=10000 \
node scripts/queue-health-check.mjs
```

**Usage in CI/CD:**

```bash
# Fail pipeline if queues are critical
if ! node scripts/queue-health-check.mjs; then
  echo "Queue health check failed (exit code: $?)"
  exit 1
fi
```

**Output:**

The script generates both human-readable console output and machine-parseable exit codes:

```
✗ Queue Health Check Report
Timestamp: 2026-05-30T10:15:00.000Z
Duration: 245ms
Status: CRITICAL
Message: Critical issues detected

Summary:
  Total Queues: 4
  ✓ Healthy: 2
  ⚠ Warnings: 1
  ✗ Critical: 1

Queue Details:

  portfolio-check: healthy
    Metrics:
      Waiting: 0
      Active: 1
      Delayed: 0
      Failed: 0
      Completed: 4521
      Backlog: 0
      Worker Lag: 0.00
      Drain Rate: 100.0%
      Failure Rate: 0.0%

  rebalance: critical
    Metrics:
      Waiting: 85
      Active: 0
      Delayed: 25
      Failed: 12
      Completed: 320
      Backlog: 122
      Worker Lag: inf
      Drain Rate: 96.4%
      Failure Rate: 3.6%
    Issues:
      - Critical backlog: 122 jobs (threshold: 100)
      - No active workers but 85 jobs waiting

Exit code: 2
```

## Real-time Event Flow

The backend currently has two connected real-time paths:

1. **On-chain ingestion path** (`contractEventIndexer`) that syncs Soroban contract events into backend persistence.
2. **WebSocket push path** (`RebalancingService` + `websocket.service.ts`) that broadcasts runtime portfolio/risk events to connected frontend clients.

```mermaid
flowchart LR
    A[Soroban Contract Event<br/>portfolio.created / deposit / rebalanced]
    B[contractEventIndexer.syncOnce<br/>backend/src/services/contractEventIndexer.ts]
    C[(Database: rebalance history + indexer cursor)]
    D[BullMQ Queue<br/>portfolio-check / rebalance workers]
    E[RebalancingService notifyClients<br/>portfolio_update / market_update]
    F[WebSocket server<br/>initRobustWebSocket]
    G[Frontend RebalancerWSClient]
    H[Frontend RealtimeConnectionContext state]

    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
    F --> G
    G --> H
```

### WebSocket Message Schema

Protocol envelope validated in `backend/src/types/websocket.ts`:

- `version: string` (must equal `1.0.0`)
- `type: "PING" | "PONG" | "PRICE_UPDATE" | "REBALANCE_STATUS" | "ERROR"`
- `payload?: unknown`
- `timestamp: number` (milliseconds since epoch; defaults server-side when parsed)

Additional server-sent broadcast message shapes used by `RebalancingService`:

- `type: "portfolio_update"`
  - `portfolioId: string`
  - `event: string` (example: `rebalance_queued`, `rebalance_blocked`, `risk_alert`)
  - `data?: object`
  - `timestamp: string` (ISO datetime)
- `type: "market_update"`
  - `event: string`
  - `data?: object`
  - `timestamp: string` (ISO datetime)

Connection lifecycle messages used in `websocket.service.ts`:

- On connect: `{ "type": "connection", "message": "Validation and Monitoring Active", "version": "1.0.0" }`
- Protocol mismatch / invalid frame: `{ "type": "ERROR", "payload": "Incompatible version or format. Use v1.0.0" }`
- Ping response: `{ "type": "PONG", "version": "1.0.0" }`

## Structured Logging Schema

The backend uses `pino` to output structured JSON logs. This schema ensures logs are easily searchable and correlatable in Loki or any other log aggregator.

### Base Log Fields

Every log entry automatically includes the following standard fields:

- `level`: The severity of the log (e.g., `info`, `warn`, `error`).
- `time`: ISO 8601 formatted timestamp of when the event occurred.
- `service`: Identifies the source component (always `stellar-portfolio-backend`).
- `environment`: The deployment environment (`development`, `production`, etc.).
- `msg`: The human-readable log message.

### Correlation Keys

To trace a single logical operation across multiple log statements or services, we inject correlation IDs into the log payload.

- `requestId`: A unique identifier for the current HTTP request. It is automatically injected into all logs emitted within the request context via `AsyncLocalStorage`.

If you are logging within a worker or queue context, ensure you include a `jobId` or equivalent correlation key manually when starting the context.

### Audit Logs

Significant system actions (e.g., portfolio creations, configuration changes) are tracked using a dedicated `logAudit` helper. These logs contain:

- `event`: Always set to `"audit"`.
- `action`: A string describing the specific action taken (e.g., `portfolio_created`, `rebalance_triggered`).
- Additional fields specific to the action can be merged into the payload.

### Redaction

For security and compliance, sensitive fields in log payloads (like passwords, tokens, or PII) are automatically redacted before the log is printed.
