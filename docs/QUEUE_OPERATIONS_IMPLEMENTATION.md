# Queue Operations Dashboard Implementation Summary

**Implementation Date**: May 30, 2026  
**Category**: DevOps / Observability  
**Status**: ✅ Complete

## Overview

Created a comprehensive operational dashboard and health monitoring system for background job queues (BullMQ). The system provides real-time visibility into queue depth, worker capacity, and failure patterns through a dedicated Grafana dashboard, enhanced Prometheus metrics, and automated health checks.

## Deliverables

### 1. ✅ Grafana Dashboard: "Queue Operations & Worker Lag"

**File**: [deployment/observability/grafana/dashboards/queue-operations.json](../deployment/observability/grafana/dashboards/queue-operations.json)

**Key Features**:

- **10 panels** visualizing queue health from multiple angles
- **Real-time metrics** refreshing every 10 seconds
- **Worker lag analysis** — ratio of waiting jobs to active workers
- **Failure tracking** — failed jobs, failure rates, drain behavior
- **Log aggregation** — queue worker logs and error logs side-by-side
- **Customizable time range** — default 1 hour, suitable for live incident response

**Panels**:

1. Queue Waiting Jobs (jobs queued but not processing)
2. Active Workers (Processing) (workers executing jobs)
3. Failed Jobs (job failures per queue)
4. Delayed Jobs (Retrying) (jobs scheduled for retry)
5. Completed Jobs (Drain Rate) (successful job throughput)
6. Total Queue Backlog (sum of unprocessed jobs)
7. Worker Lag Ratio (backlog / active workers)
8. Queue Composition by State (stacked view over time)
9. Queue Worker Logs (real-time worker output)
10. Error and Failure Logs (error-level logs)

### 2. ✅ Enhanced Prometheus Metrics

**File**: [backend/src/observability/metrics.ts](../backend/src/observability/metrics.ts)

**New Metrics Added**:

- `stellar_portfolio_queue_worker_lag` — Worker lag ratio: (waiting + delayed) / (active + 1)
- `stellar_portfolio_queue_drain_rate` — Ratio of completed to total processed jobs
- `stellar_portfolio_queue_failure_rate` — Ratio of failed to total processed jobs

**Calculation Details**:

- Worker lag uses "+1" denominator to prevent division by zero and represent single-worker minimum
- Drain rate = completed / (completed + failed) — 1.0 means all jobs succeed
- Failure rate = failed / (completed + failed) — high values indicate systematic issues

### 3. ✅ Queue Health Check Script

**File**: [scripts/queue-health-check.mjs](../scripts/queue-health-check.mjs)

**Capabilities**:

- **Automated health assessment** of all 4 queues (portfolio-check, rebalance, analytics-snapshot, idempotency-cleanup)
- **Configurable thresholds** via environment variables
- **Exit codes** for CI/CD integration (0=healthy, 1=warning, 2=critical, 3=error)
- **Human-readable output** with color-coded status and metric summaries
- **Machine-parseable output** for scripting and automation

**Example Usage**:

```bash
node scripts/queue-health-check.mjs                    # Check local backend
BACKEND_URL=https://api.prod.example.com \
  node scripts/queue-health-check.mjs --verbose       # Check production with details
```

**Environment Variables**:

- `BACKEND_URL` — Backend API URL (default: http://localhost:3001)
- `QUEUE_CRITICAL_BACKLOG` — Critical threshold (default: 100 jobs)
- `QUEUE_WARNING_BACKLOG` — Warning threshold (default: 50 jobs)
- `QUEUE_CRITICAL_LAG` — Critical lag ratio (default: 10)
- `QUEUE_WARNING_LAG` — Warning lag ratio (default: 5)
- `QUEUE_CRITICAL_FAILURE` — Critical failure rate (default: 0.3)
- `QUEUE_WARNING_FAILURE` — Warning failure rate (default: 0.1)
- `HEALTH_CHECK_TIMEOUT` — Request timeout (default: 10000ms)

### 4. ✅ Prometheus Alert Rules

**File**: [deployment/observability/prometheus/alerts.yml](../deployment/observability/prometheus/alerts.yml)

**9 Alert Rules Implemented**:

| Alert                           | Severity | Condition                         | Description                          |
| ------------------------------- | -------- | --------------------------------- | ------------------------------------ |
| `QueueCriticalBacklog`          | Critical | Backlog > 100 for 10min           | Large unprocessed job accumulation   |
| `QueueWarningBacklog`           | Warning  | Backlog > 50 for 15min            | Early backlog warning                |
| `QueueHighWorkerLag`            | Critical | Lag ratio > 10 for 5min           | Workers severely behind job arrival  |
| `QueueWarningWorkerLag`         | Warning  | Lag ratio > 5 for 10min           | Workers struggling to keep up        |
| `QueueHighFailureRate`          | Critical | Failure rate > 30% for 5min       | Majority of jobs failing             |
| `QueueElevatedFailureRate`      | Warning  | Failure rate > 10% for 10min      | Elevated failure rate                |
| `QueueNoActiveWorkers`          | Critical | Active = 0 & waiting > 0 for 3min | Workers crashed while jobs waiting   |
| `QueueDrainRateDegraded`        | Warning  | Drain rate < 70% for 15min        | Increasing failure impact            |
| `AnalyticsQueueBacklog`         | Info     | Waiting > 10 for 30min            | Non-critical analytics queue backlog |
| `IdempotencyCleanupQueueIssues` | Warning  | Failed jobs > 5 for 1h            | Cleanup job failures                 |

**Firing Conditions** (all require minimum duration):

- Critical alerts fire after 3–10 minutes of threshold breach
- Warning alerts fire after 10–30 minutes of threshold breach
- Info alerts fire after 30+ minutes for non-critical monitoring

### 5. ✅ Operational Workflow Documentation

**File**: [docs/QUEUE_OPERATIONS_WORKFLOW.md](../docs/QUEUE_OPERATIONS_WORKFLOW.md)

**7 Detailed Runbooks**:

1. **Routine Monitoring** — Daily health verification
2. **Elevated Backlog Response** — Diagnose and resolve backlog accumulation
3. **High Worker Lag** — Address situations where workers fall behind
4. **High Failure Rate** — Investigate and resolve systematic failures
5. **No Active Workers** — Emergency response for worker crashes
6. **Pre-Deployment Validation** — Safety checklist before deploying changes
7. **Post-Incident Analysis** — Understanding what went wrong and preventing recurrence

**Additional Sections**:

- CI/CD Integration examples (GitHub Actions, shell scripts)
- Threshold Customization guide
- Support & Troubleshooting FAQs
- References to related documentation

### 6. ✅ Documentation Updates

**Files Updated**:

- [docs/OBSERVABILITY.md](../docs/OBSERVABILITY.md) — Added Queue Operations Dashboard and Queue Metrics Reference sections
- [docs/OPERATIONS.md](../docs/OPERATIONS.md) — Added Queue Operations Monitoring section with dashboard and health check references
- [docs/CONTRIBUTING.md](../docs/CONTRIBUTING.md) — References to queue operations documentation (no changes needed, already linked)

## Acceptance Criteria Met

### ✅ The operational workflow is repeatable and documented

**Evidence**:

- Detailed step-by-step runbooks for 7 operational scenarios in [QUEUE_OPERATIONS_WORKFLOW.md](../docs/QUEUE_OPERATIONS_WORKFLOW.md)
- All workflows include diagnostic steps, resolution procedures, and success criteria
- Examples include configuration options, commands to run, and expected outputs
- CI/CD integration examples showing how to automate queue health checks

### ✅ Failure conditions are surfaced clearly in CI, alerts, or scripts

**Evidence**:

- **9 Prometheus alert rules** in [alerts.yml](../deployment/observability/prometheus/alerts.yml) covering all critical queue failure scenarios
- **Health check script** with exit codes (0/1/2/3) for easy CI/CD integration
- **Dashboard visualizations** that immediately highlight anomalies:
  - Worker lag spikes visible as upward trends
  - Failed job accumulation shown in red
  - Drain rate degradation apparent in completed job slopes
- **Color-coded status** in health check output and dashboard
- **Multiple severity levels** (info, warning, critical) for proportional response

### ✅ Any new automation can be exercised without manual guesswork

**Evidence**:

- **Standalone health check** works immediately: `node scripts/queue-health-check.mjs`
- **Dashboard** is auto-provisioned in Grafana from JSON file
- **Alerts** are auto-loaded by Prometheus from prometheus.yml
- **All environment variables** documented with defaults; no guessing required
- **Metrics** are automatically collected and exported from backend `/metrics` endpoint
- **Example scripts** provided for CI/CD, shell, and GitHub Actions workflows
- **Docker Compose** already configured to mount and provision all components

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Backend API (Node.js)                        │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  BullMQ Queues (4 total)                                 │  │
│  │  • portfolio-check (every 30 min)                        │  │
│  │  • rebalance (on-demand + auto)                          │  │
│  │  • analytics-snapshot (every 60 min)                     │  │
│  │  • idempotency-cleanup (every 60 min)                    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                            │                                    │
│               ┌────────────┼────────────┐                       │
│               ▼            ▼            ▼                       │
│           Queue         Redis          Queue                   │
│          Workers       (data)         Metrics                  │
│                         ↓              ↓                       │
│                    REDIS_URL    /metrics endpoint              │
│                                                                 │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                    Prometheus Scrape (15s interval)
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
            ┌──────────────┐          ┌──────────────┐
            │  Prometheus  │          │ Alert Rules  │
            │  Time Series │          │  (9 rules)   │
            │   Database   │          │              │
            └──────────────┘          └──────────────┘
                    │                         │
                    │    Alert Evaluation     │
                    ├─────────────────────────┘
                    │
        ┌───────────┴────────────┐
        ▼                        ▼
    ┌─────────────┐      ┌──────────────┐
    │   Grafana   │      │  Alertmanager │
    │ Dashboards  │      │  → Slack/etc  │
    │             │      │              │
    │ • Overview  │      └──────────────┘
    │ • Queue Ops │
    └─────────────┘
        ▲
        │ Query
        │
    Local Browser
    http://localhost:3003
```

## Usage Workflow

### Development/Local Testing

```bash
# 1. Start monitoring stack
docker compose -f deployment/docker-compose.yml --profile monitoring up --build

# 2. Access dashboard
# → Grafana: http://localhost:3003
# → Prometheus: http://localhost:9090
# → Alertmanager: http://localhost:9093

# 3. Check queue health
node scripts/queue-health-check.mjs

# 4. Trigger test jobs (if you have a rebalance job)
# API will automatically enqueue jobs

# 5. Watch dashboard update in real-time
# Observe queue depth, worker lag, failure rates
```

### Pre-Deployment Validation

```bash
# 1. Check baseline health
node scripts/queue-health-check.mjs > /tmp/baseline.txt

# 2. Deploy changes
git pull && docker compose build && docker compose up -d

# 3. Wait and re-check
sleep 120
node scripts/queue-health-check.mjs > /tmp/postdeploy.txt

# 4. Compare
diff /tmp/baseline.txt /tmp/postdeploy.txt  # Should show no regression
```

### CI/CD Integration

```bash
# GitHub Actions example
name: Queue Health Check
on: [deployment]
jobs:
  queue-health:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: node scripts/queue-health-check.mjs
        env:
          BACKEND_URL: ${{ secrets.BACKEND_URL }}
```

### Operational Response

```bash
# Alert fires: QueueCriticalBacklog
# 1. Investigate
node scripts/queue-health-check.mjs --verbose

# 2. Diagnose (open Grafana dashboard)
# → Check "Total Queue Backlog" panel
# → Check "Active Workers" — are they zero?
# → Check "Error and Failure Logs" — what's failing?

# 3. Resolve
# → If workers are dead: docker compose restart backend
# → If backlog is temporary: wait for drain (watch "Completed Jobs")
# → If failures are high: check Sentry for root cause

# 4. Verify
node scripts/queue-health-check.mjs  # Should return exit code 0
```

## File Changes Summary

### New Files Created

1. `deployment/observability/grafana/dashboards/queue-operations.json` (484 lines)
2. `scripts/queue-health-check.mjs` (424 lines)
3. `docs/QUEUE_OPERATIONS_WORKFLOW.md` (640 lines)

### Files Modified

1. `backend/src/observability/metrics.ts` — Added 3 new gauge metrics (worker lag, drain rate, failure rate)
2. `deployment/observability/prometheus/alerts.yml` — Added 9 queue operation alert rules
3. `docs/OBSERVABILITY.md` — Added Queue Operations Dashboard and Queue Metrics Reference sections
4. `docs/OPERATIONS.md` — Added Queue Operations Monitoring section with references

### No Breaking Changes

- All changes are backward compatible
- New metrics are additive (no existing metrics modified)
- Dashboard is auto-provisioned (no manual steps required)
- Health check is standalone (no dependencies on other tools)

## Testing & Validation

### Local Validation Checklist

```bash
# 1. Verify dashboard loads
curl http://localhost:3003/api/dashboards/uid/queue-operations
# Should return 200 with dashboard JSON

# 2. Verify metrics are exposed
curl http://localhost:3001/metrics | grep stellar_portfolio_queue
# Should show metrics like:
# stellar_portfolio_queue_jobs{queue="portfolio-check",state="waiting"} 0
# stellar_portfolio_queue_worker_lag{queue="portfolio-check"} 0
# stellar_portfolio_queue_drain_rate{queue="portfolio-check"} 1
# stellar_portfolio_queue_failure_rate{queue="portfolio-check"} 0

# 3. Verify health check runs
node scripts/queue-health-check.mjs
# Should show queue status and return appropriate exit code

# 4. Verify alerts are loaded
curl http://localhost:9090/api/v1/rules | grep -i queue
# Should show all 9 queue-related alert rules
```

### Production Readiness

- ✅ Metrics calculated correctly and efficiently
- ✅ Dashboard visualizations are clear and actionable
- ✅ Health check can be run in CI/CD pipelines
- ✅ Alert thresholds are reasonable (tunable via environment)
- ✅ No additional external dependencies required
- ✅ All components are self-contained and auto-provisioned
- ✅ Documentation is complete with real-world scenarios

## Maintenance & Future Enhancements

### Recommended Next Steps

1. **Add job processing duration histogram** — Track how long jobs take to complete (helps identify slow jobs)
2. **Add per-worker-instance metrics** — Track individual worker performance (requires worker instance tracking)
3. **Add custom queue drain rate SLO** — Enforce objective that 95% of jobs complete within SLA
4. **Integrate with Opsgenie/PagerDuty** — Route critical alerts to on-call engineers
5. **Add anomaly detection** — Alert when backlog grows faster than usual (ML-based)

### Tuning Guidelines

**For high-throughput systems** (>1000 jobs/min):

- Increase `QUEUE_CRITICAL_BACKLOG` to 500
- Increase `QUEUE_CRITICAL_LAG` to 20
- Decrease alert `for` duration to 3-5 minutes

**For latency-sensitive systems** (<100ms per job):

- Decrease `QUEUE_CRITICAL_BACKLOG` to 10
- Decrease `QUEUE_CRITICAL_LAG` to 2
- Increase alert `for` duration to 10-15 minutes

**For bursty workloads** (batch jobs):

- Use info-level alerts for non-critical queues
- Set longer `for` durations (20-30 minutes)
- Manually acknowledge alerts during known batch windows

## Support

For questions or issues with queue operations:

1. Check [QUEUE_OPERATIONS_WORKFLOW.md](../docs/QUEUE_OPERATIONS_WORKFLOW.md) for troubleshooting
2. Review [OBSERVABILITY.md](../docs/OBSERVABILITY.md) for metric definitions
3. Check [OPERATIONS.md](../docs/OPERATIONS.md) for architecture details
4. Examine dashboard panels and logs in Grafana
5. Run health check for programmatic diagnostics

---

**Last Updated**: May 30, 2026  
**Implementation Complete**: ✅ All acceptance criteria met
