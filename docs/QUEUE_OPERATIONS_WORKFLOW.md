# Queue Operations Workflow

This document provides repeatable operational workflows for managing and troubleshooting background job queues using the Queue Operations dashboard, metrics, and health checks.

## Quick Start

### 1. Accessing the Dashboard

Once the monitoring stack is running:

```bash
docker compose -f deployment/docker-compose.yml --profile monitoring up --build
```

Navigate to Grafana:

- **URL**: `http://localhost:3003`
- **Default credentials**: admin/admin
- **Dashboard**: "Queue Operations & Worker Lag"

### 2. Running Health Checks

To programmatically check queue health:

```bash
# Check local backend
node scripts/queue-health-check.mjs

# Check production backend
BACKEND_URL=https://api.production.example.com node scripts/queue-health-check.mjs

# Check with verbose output
node scripts/queue-health-check.mjs --verbose

# Use as CI/CD gate
if ! node scripts/queue-health-check.mjs; then
  echo "Queue health check failed (exit code: $?)"
  exit 1
fi
```

### 3. Understanding Metrics

Key metrics displayed on the dashboard:

| Metric           | What It Means                        | Healthy Range  |
| ---------------- | ------------------------------------ | -------------- |
| Waiting Jobs     | Jobs queued but not processing       | 0-10           |
| Active Workers   | Workers executing jobs               | >= 1 per queue |
| Backlog          | Total queued + delayed + failed jobs | 0-50           |
| Worker Lag Ratio | (Waiting + Delayed) / Active         | 0-5            |
| Failure Rate     | Failed / (Failed + Completed)        | < 10%          |
| Drain Rate       | Completed / (Completed + Failed)     | > 90%          |

## Operational Scenarios

### Scenario 1: Routine Monitoring

**Objective**: Verify queue health during normal operation.

**Steps**:

1. Open Queue Operations dashboard in Grafana
2. Check "Total Queue Backlog" panel – should be trending downward to zero
3. Check "Worker Lag Ratio" panel – should be < 2 for all queues
4. Check "Failed Jobs" and "Error and Failure Logs" panels
5. If all healthy, no action needed

**Success Criteria**:

- ✓ All backlog panels trend toward zero
- ✓ No worker lag spikes
- ✓ < 5% overall failure rate
- ✓ Active workers present on each queue

---

### Scenario 2: Elevated Backlog Alert

**Objective**: Respond to high queue backlog accumulation.

**Alert Trigger**: `QueueCriticalBacklog` or `QueueWarningBacklog`

**Diagnostic Steps**:

1. **Confirm the issue**:

   ```bash
   node scripts/queue-health-check.mjs --verbose
   ```

   Look for "Critical backlog" or "High backlog" in the output.

2. **Identify the affected queue**:
   - Open Queue Operations dashboard
   - Check which queue(s) show high waiting job count
   - Cross-reference with Active Workers panel

3. **Check for worker failures**:
   - Look at "Queue Worker Logs" panel
   - Search for ERROR or WARN level messages
   - Check Sentry dashboard for recent exceptions

4. **Assess drain rate**:
   - If drain rate > 90%, workers are healthy; backlog is temporary
   - If drain rate < 70%, workers are experiencing failures; investigate root cause

**Resolution Steps**:

**Case A: Workers are processing (drain rate > 90%)**

- Wait for backlog to drain naturally
- Monitor completion rate in "Completed Jobs (Drain Rate)" panel
- Typical drain time: 5-30 minutes depending on job complexity

**Case B: Workers are failing (drain rate < 70%)**

- Click on "Error and Failure Logs" panel to see recent errors
- Common causes:
  - **Timeout errors**: Increase job timeout in `backend/src/queue/queues.ts`
  - **Stellar network issues**: Check blockchain node connectivity
  - **Rate limit errors**: Check API key quotas for Reflector/CoinGecko
  - **Database connection pool exhaustion**: Increase `DB_POOL_SIZE` in `.env`
- Fix the root cause, then restart the backend:
  ```bash
  docker compose restart backend
  ```
- Monitor backlog draining over next 15 minutes

**Case C: No active workers**

- Check "Active Workers (Processing)" panel
- If active = 0, workers have crashed or scaled to zero
- Restart the backend:
  ```bash
  docker compose restart backend
  ```
- Verify workers are running:
  ```bash
  docker compose logs backend | grep WORKER
  ```
- Wait 2-3 minutes for jobs to start processing

---

### Scenario 3: High Worker Lag Ratio

**Objective**: Address situations where workers cannot keep up with job arrival.

**Alert Trigger**: `QueueHighWorkerLag` or `QueueWarningWorkerLag`

**Diagnostic Steps**:

1. **Confirm the ratio**:

   ```bash
   node scripts/queue-health-check.mjs --verbose
   ```

   Look for "Worker Lag Ratio" > 5.

2. **Check job arrival rate**:
   - Open Prometheus: `http://localhost:9090`
   - Graph: `rate(stellar_portfolio_queue_jobs{state="waiting"}[5m])`
   - High positive slope = jobs arriving faster than being processed

3. **Check worker capacity**:
   - Graph: `stellar_portfolio_queue_jobs{state="active"}`
   - Compare to job arrival rate
   - Calculate: Jobs/Min ÷ Active Workers = Jobs/Worker/Min

**Resolution Steps**:

**Option A: Scale workers (long-term)**

- Add more worker processes or containers
- For Docker: Increase replicas in docker-compose.yml or K8s deployment
- For direct Node: Start additional `node backend/src/queue/workers/*.ts` processes

**Option B: Optimize job processing (medium-term)**

- Profile slow jobs in "Queue Worker Logs"
- Common bottlenecks:
  - Slow database queries → add indexes
  - Slow external API calls → implement caching
  - Expensive calculations → optimize algorithm
- Deploy optimizations and restart workers

**Option C: Implement backpressure (short-term)**

- Temporarily disable automatic rebalancing to reduce job arrival
- Set `ENABLE_AUTO_REBALANCE=false` in backend `.env`
- Let workers catch up
- Re-enable after backlog clears

---

### Scenario 4: High Failure Rate

**Objective**: Diagnose and resolve systematic job failures.

**Alert Trigger**: `QueueHighFailureRate` or `QueueElevatedFailureRate`

**Diagnostic Steps**:

1. **Identify failure type**:
   - Open "Error and Failure Logs" panel
   - Look for repeated error messages
   - Common patterns:
     - `ECONNREFUSED` = Backend service down or unreachable
     - `TimeoutError` = Job takes > timeout threshold
     - `Unauthorized` = API key invalid or expired
     - `RateLimit` = Too many requests to external API

2. **Check affected queue**:
   - From "Failed Jobs" panel, identify which queue(s) are failing
   - Cross-reference job types with error messages

3. **Verify root cause**:
   - For external API failures: Check service status page
   - For database failures: Check `docker compose logs db`
   - For Stellar network: Check `https://testnet.soroban.stellar.org/`

**Resolution Steps**:

**For Transient Failures** (network blips, temporary API downtime):

- Jobs auto-retry with exponential backoff (5s, 10s, 20s, 40s, 80s)
- Monitor "Delayed Jobs (Retrying)" to see if retries succeed
- If retry rate > 80%, issue is likely transient

**For Permanent Failures** (invalid configuration, wrong contract address):

- Fix the root cause in backend code or environment config
- Deploy fix
- Restart backend to clear failed jobs:
  ```bash
  docker compose restart backend
  ```
- Failed jobs won't auto-retry but new jobs will use corrected code

**For Cascading Failures** (one queue failure affecting others):

- Isolate the problematic queue
- Stop only that queue worker if possible
- Fix the issue
- Restart the specific worker

---

### Scenario 5: No Active Workers But Jobs Waiting

**Objective**: Emergency response when all workers have crashed.

**Alert Trigger**: `QueueNoActiveWorkers`

**Immediate Action**:

```bash
# Check if backend is running
docker compose ps backend

# If not running, start it
docker compose up -d backend

# Verify logs
docker compose logs -f backend

# Wait for workers to initialize (30-60 seconds)
# Then verify with health check
node scripts/queue-health-check.mjs
```

**If Backend is Running But No Workers**:

1. Check for startup errors:

   ```bash
   docker compose logs backend | grep -i "error\|worker\|queue"
   ```

2. Common causes:
   - **Redis not available**: Check `docker compose logs redis`
   - **Database not available**: Check `docker compose logs db`
   - **Environment misconfiguration**: Check `.env` file

3. Fix and restart:

   ```bash
   # Fix the issue (e.g., restart Redis)
   docker compose restart redis

   # Restart backend to reconnect
   docker compose restart backend

   # Monitor
   docker compose logs -f backend
   ```

---

### Scenario 6: Pre-Deployment Validation

**Objective**: Validate queue system before deploying changes.

**Checklist**:

1. **Run baseline health check**:

   ```bash
   node scripts/queue-health-check.mjs > /tmp/pre-deploy-health.txt
   ```

   Document baseline state.

2. **Deploy changes**:

   ```bash
   git pull
   docker compose build backend
   docker compose up -d backend
   ```

3. **Monitor for 5-10 minutes**:
   - Watch Queue Operations dashboard
   - Check for any new errors in logs

4. **Run post-deploy health check**:

   ```bash
   sleep 120  # Wait 2 minutes for jobs to process
   node scripts/queue-health-check.mjs > /tmp/post-deploy-health.txt
   ```

5. **Compare**:

   ```bash
   diff /tmp/pre-deploy-health.txt /tmp/post-deploy-health.txt
   ```

   - Exit code 0 = health unchanged (✓ safe)
   - Exit code non-zero = health changed (⚠ review carefully)

6. **Rollback if needed**:
   ```bash
   git revert HEAD
   docker compose build backend
   docker compose up -d backend
   node scripts/queue-health-check.mjs
   ```

---

### Scenario 7: Post-Incident Analysis

**Objective**: Understand what went wrong and prevent recurrence.

**Steps**:

1. **Gather timeline**:
   - Check Alertmanager: `http://localhost:9093`
   - Note when critical alerts fired
   - Cross-reference with Grafana dashboard time annotations

2. **Review logs**:

   ```bash
   # Download backend logs for incident window
   docker compose logs backend > /tmp/backend-incident.log

   # Search for root cause
   grep -i "error\|critical\|failed" /tmp/backend-incident.log | head -50
   ```

3. **Analyze queue metrics**:
   - Go to Queue Operations dashboard
   - Set time range to incident window
   - Screenshot panels showing:
     - Backlog growth
     - Worker lag spike
     - Failure rate increase
     - When backlog started draining

4. **Generate incident report**:

   ```markdown
   ## Incident Report

   **Date**: 2026-05-30
   **Duration**: 14:00 - 14:45 UTC (45 minutes)
   **Severity**: Critical

   **Timeline**:

   - 14:00 - High backlog alert triggered
   - 14:05 - Worker lag ratio exceeded threshold
   - 14:10 - Workers restarted
   - 14:15 - Backlog started draining
   - 14:45 - All queues healthy

   **Root Cause**:
   [Describe what triggered the incident]

   **Resolution**:
   [Describe what fixed it]

   **Prevention**:
   [What can be done to prevent recurrence]
   ```

5. **Create follow-up tasks**:
   - Add monitoring rule if missing
   - Increase timeout/resource if systematic
   - Document runbook if new scenario

---

## Integration with CI/CD

### GitHub Actions Example

```yaml
name: Queue Health Check

on:
  deployment: {}

jobs:
  queue-health:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v3

      - name: Install Node
        uses: actions/setup-node@v3
        with:
          node-version: 18

      - name: Check Queue Health
        env:
          BACKEND_URL: ${{ secrets.BACKEND_URL }}
        run: node scripts/queue-health-check.mjs

      - name: Report Status
        if: failure()
        uses: actions/github-script@v6
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '❌ Queue health check failed. Review logs above.'
            })
```

### Manual Pre-Deployment Check

```bash
#!/bin/bash
set -e

echo "🔍 Checking queue health before deployment..."
HEALTH_EXIT=0
node scripts/queue-health-check.mjs || HEALTH_EXIT=$?

if [ $HEALTH_EXIT -eq 0 ]; then
  echo "✅ Queue health check passed - safe to deploy"
  exit 0
elif [ $HEALTH_EXIT -eq 1 ]; then
  echo "⚠️  Queue has warnings - review and confirm to proceed"
  read -p "Continue? (y/n) " -n 1 -r
  echo
  [[ $REPLY =~ ^[Yy]$ ]] && exit 0 || exit 1
else
  echo "❌ Queue health check critical - do NOT deploy"
  exit 2
fi
```

---

## Threshold Customization

To adjust alert thresholds for your environment:

### 1. Queue Health Check Script

Edit environment variables when running:

```bash
QUEUE_CRITICAL_BACKLOG=200 \
QUEUE_WARNING_BACKLOG=100 \
QUEUE_CRITICAL_LAG=15 \
QUEUE_WARNING_LAG=8 \
node scripts/queue-health-check.mjs
```

Or set in `.env`:

```bash
QUEUE_CRITICAL_BACKLOG=200
QUEUE_WARNING_BACKLOG=100
QUEUE_CRITICAL_LAG=15
QUEUE_WARNING_LAG=8
```

### 2. Prometheus Alerts

Edit `deployment/observability/prometheus/alerts.yml`:

```yaml
- alert: QueueCriticalBacklog
  expr: (stellar_portfolio_queue_jobs{state="waiting"} + stellar_portfolio_queue_jobs{state="delayed"} + stellar_portfolio_queue_jobs{state="failed"}) > 200 # Changed from 100
  for: 10m
```

Then reload Prometheus:

```bash
# Send SIGHUP to Prometheus (or restart container)
docker compose restart prometheus
```

---

## Support & Troubleshooting

### Dashboard Shows "No Data"

- **Cause**: Prometheus not scraping metrics
- **Fix**: Check `deployment/observability/prometheus/prometheus.yml`
- **Verify**:
  ```bash
  curl http://localhost:3001/metrics | grep queue
  ```

### Health Check Can't Connect to Backend

- **Cause**: Backend URL incorrect or backend down
- **Fix**: Verify `BACKEND_URL` environment variable
- **Verify**:
  ```bash
  curl ${BACKEND_URL}/metrics
  ```

### Alerts Not Firing Despite High Backlog

- **Cause**: Alert rules not loaded or Prometheus not evaluating
- **Fix**: Restart Prometheus
  ```bash
  docker compose restart prometheus
  ```
- **Verify**:
  ```bash
  curl http://localhost:9090/api/v1/rules
  ```

### Alert Fatigue (Too Many Alerts)

- Adjust thresholds in `alerts.yml` to be less sensitive
- Increase `for` duration to filter transient spikes
- Example: Change `for: 5m` to `for: 15m`

---

## References

- [BullMQ Documentation](https://docs.bullmq.io/)
- [Prometheus Alerting](https://prometheus.io/docs/alerting/latest/overview/)
- [Grafana Dashboards](https://grafana.com/docs/grafana/latest/dashboards/)
- Queue architecture: `docs/QUEUE_WORKER_LIFECYCLE.md`
- Observability setup: `docs/OBSERVABILITY.md`
