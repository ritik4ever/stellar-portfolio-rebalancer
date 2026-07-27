# Queue Worker Lifecycle and Retry Model

This guide explains how async jobs move through the queue system, how retries work, and what to expect when things fail. Use this to understand job scheduling, worker deployment, and operational monitoring.

## Quick Reference

| Concept             | Details                                                              |
| ------------------- | -------------------------------------------------------------------- |
| **Queue system**    | BullMQ + Redis (backend/src/queue/)                                  |
| **Queues**          | portfolio-check, rebalance, analytics-snapshot, idempotency-cleanup  |
| **Default retries** | 5 attempts with exponential backoff (5s → 10s → 20s → 40s → 80s)     |
| **Job TTL**         | Successful jobs removed after 100 completions; failed jobs after 200 |
| **Scheduler**       | Runs when Redis available; registers repeatable cron jobs            |
| **Workers**         | Must be explicitly started; not auto-spawned by `npm start`          |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Backend (Node.js)                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  HTTP API (npm start)                                    │  │
│  │  - Enqueues jobs on demand (e.g., POST /rebalance)       │  │
│  │  - Starts scheduler when Redis available                 │  │
│  │  - Does NOT spawn workers                                │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           ↓                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Queue Scheduler (backend/src/queue/scheduler.ts)        │  │
│  │  - Registers repeatable cron jobs                        │  │
│  │  - Enqueues startup jobs (portfolio-check, analytics)    │  │
│  │  - Runs every 60s (portfolio-check), 5min (analytics)    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           ↓                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Redis (REDIS_URL)                                       │  │
│  │  - Stores job queue state                                │  │
│  │  - Persists job data and retry metadata                  │  │
│  │  - Holds repeatable job definitions                      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           ↓                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Workers (separate process or same process)              │  │
│  │  - portfolioCheckWorker (concurrency: 2)                 │  │
│  │  - rebalanceWorker (concurrency: 1)                      │  │
│  │  - analyticsSnapshotWorker (concurrency: 2)              │  │
│  │  - idempotencyCleanupWorker (concurrency: 1)             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           ↓                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Job Execution                                           │  │
│  │  - Process job data                                      │  │
│  │  - Update database/external services                     │  │
│  │  - Mark complete or fail                                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Job Lifecycle

### States

```
WAITING → ACTIVE → COMPLETED
           ↓
         FAILED → WAITING (retry)
           ↓
         FAILED (max retries exceeded)
```

### Detailed Flow

1. **WAITING** — Job enqueued, waiting for worker to pick it up
   - Stored in Redis queue
   - Metadata includes job data, retry count, timestamps

2. **ACTIVE** — Worker picked up job and started processing
   - Worker locks the job (prevents duplicate processing)
   - Job timeout: 30 seconds (configurable)
   - If worker crashes, job returns to WAITING after lock expires

3. **COMPLETED** — Job finished successfully
   - Result stored in Redis (TTL: 24 hours)
   - Removed from queue after 100 completions (cleanup)
   - Logged with success timestamp

4. **FAILED** — Job threw an error
   - Error message and stack trace stored
   - Retry count incremented
   - If retries remaining: job returns to WAITING with backoff delay
   - If max retries exceeded: job marked as permanently failed

### Retry Mechanism

**Default retry policy:**

```typescript
{
    attempts: 5,
    backoff: {
        type: 'exponential',
        delay: 5000, // 5 seconds
    }
}
```

**Retry delays:**

- Attempt 1: 5 seconds
- Attempt 2: 10 seconds
- Attempt 3: 20 seconds
- Attempt 4: 40 seconds
- Attempt 5: 80 seconds

**Total time to exhaust retries:** ~155 seconds (2.5 minutes)

**Example:**

```
Time 0:00 — Job enqueued
Time 0:00 — Attempt 1 starts, fails
Time 0:05 — Attempt 2 starts, fails
Time 0:15 — Attempt 3 starts, fails
Time 0:35 — Attempt 4 starts, fails
Time 1:15 — Attempt 5 starts, fails
Time 2:35 — Job marked as permanently failed
```

---

## Queue Definitions

### Portfolio Check Queue

**Purpose:** Periodically check all portfolios for rebalance drift

**Job data:**

```typescript
interface PortfolioCheckJobData {
  triggeredBy?: "scheduler" | "manual" | "startup";
  correlationId?: string;
}
```

**Schedule:** Every 60 seconds (configurable via `AUTO_REBALANCE_CHECK_INTERVAL`)

**Worker:** `backend/src/queue/workers/portfolioCheckWorker.ts`

- Concurrency: 2 (process 2 jobs in parallel)
- Fetches all portfolios from database
- Checks each portfolio for drift vs target allocations
- Enqueues rebalance jobs if drift exceeds threshold

**Failure handling:**

- If portfolio fetch fails: entire job fails and retries
- If individual portfolio check fails: logged but job continues
- If rebalance enqueue fails: logged but job continues

---

### Rebalance Queue

**Purpose:** Execute a rebalance for a specific portfolio

**Job data:**

```typescript
interface RebalanceJobData {
  portfolioId: string;
  triggeredBy?: "auto" | "manual" | "force";
  correlationId?: string;
}
```

**Trigger:** Manual API call or auto-rebalancer

**Worker:** `backend/src/queue/workers/rebalanceWorker.ts`

- Concurrency: 1 (process 1 rebalance at a time)
- Fetches portfolio and current prices
- Calculates rebalance trades
- Executes trades on Stellar blockchain
- Records rebalance history

**Failure handling:**

- If prices unavailable: job fails and retries
- If blockchain transaction fails: job fails and retries
- If rebalance history recording fails: job fails and retries
- After max retries: rebalance marked as failed, user notified

---

### Analytics Snapshot Queue

**Purpose:** Capture portfolio snapshots for analytics

**Job data:**

```typescript
interface AnalyticsSnapshotJobData {
  triggeredBy?: "scheduler" | "manual" | "startup";
  correlationId?: string;
}
```

**Schedule:** Every 5 minutes (configurable via `ANALYTICS_SNAPSHOT_INTERVAL`)

**Worker:** `backend/src/queue/workers/analyticsSnapshotWorker.ts`

- Concurrency: 2 (process 2 snapshots in parallel)
- Fetches all portfolios
- Captures current prices and allocations
- Stores snapshot in analytics table
- Prunes old snapshots (keeps last 1000 per portfolio)

**Failure handling:**

- If portfolio fetch fails: entire job fails and retries
- If snapshot storage fails: job fails and retries
- If pruning fails: logged but job continues

---

### Idempotency Cleanup Queue

**Purpose:** Remove expired idempotency keys (24-hour TTL)

**Job data:**

```typescript
interface IdempotencyCleanupJobData {
  triggeredBy?: "scheduler" | "manual" | "startup";
  correlationId?: string;
}
```

**Schedule:** Every 60 minutes

**Worker:** `backend/src/queue/workers/idempotencyCleanupWorker.ts`

- Concurrency: 1 (single cleanup process)
- Queries idempotency table for expired keys
- Deletes keys older than 24 hours
- Logs number of removed keys

**Failure handling:**

- If database query fails: job fails and retries
- If deletion fails: job fails and retries

---

## Worker Startup and Shutdown

### Starting Workers

Workers are **not** automatically started by `npm start`. You must explicitly start them:

```typescript
// In your worker host process (e.g., backend/src/workers.ts)
import { startPortfolioCheckWorker } from "./queue/workers/portfolioCheckWorker";
import { startRebalanceWorker } from "./queue/workers/rebalanceWorker";
import { startAnalyticsSnapshotWorker } from "./queue/workers/analyticsSnapshotWorker";
import { startIdempotencyCleanupWorker } from "./queue/workers/idempotencyCleanupWorker";

async function startAllWorkers() {
  await startPortfolioCheckWorker();
  await startRebalanceWorker();
  await startAnalyticsSnapshotWorker();
  await startIdempotencyCleanupWorker();

  console.log("All workers started");
}

startAllWorkers().catch(console.error);
```

### Graceful Shutdown

Stop workers cleanly before exiting:

```typescript
import {
  stopPortfolioCheckWorker,
  stopRebalanceWorker,
  stopAnalyticsSnapshotWorker,
  stopIdempotencyCleanupWorker,
} from "./queue/workers/*";
import { stopQueueScheduler, closeAllQueues } from "./queue/scheduler";

async function gracefulShutdown() {
  console.log("Shutting down workers...");

  // Stop workers
  await stopPortfolioCheckWorker();
  await stopRebalanceWorker();
  await stopAnalyticsSnapshotWorker();
  await stopIdempotencyCleanupWorker();

  // Stop scheduler
  await stopQueueScheduler();

  // Close queue connections
  await closeAllQueues();

  console.log("Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
```

---

## Deployment Patterns

### Single Process (Development)

```bash
# Terminal 1: API + Scheduler
npm start

# Terminal 2: Workers
npm run workers
```

**Pros:** Simple, all-in-one
**Cons:** Workers block API if overloaded

### Separate Worker Process (Production)

```bash
# Terminal 1: API + Scheduler
npm start

# Terminal 2: Dedicated worker host
npm run workers:dedicated
```

**Pros:** Workers don't block API, can scale independently
**Cons:** Requires separate process management

### Kubernetes Deployment

```yaml
# API + Scheduler pod
apiVersion: apps/v1
kind: Deployment
metadata:
  name: stellar-api
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: api
          image: stellar-portfolio:latest
          command: ["npm", "start"]
          env:
            - name: REDIS_URL
              value: redis://redis-service:6379

---
# Dedicated worker pod
apiVersion: apps/v1
kind: Deployment
metadata:
  name: stellar-workers
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: workers
          image: stellar-portfolio:latest
          command: ["npm", "run", "workers:dedicated"]
          env:
            - name: REDIS_URL
              value: redis://redis-service:6379
```

---

## Monitoring and Observability

### Worker Runtime Status

Each worker tracks its own status:

```typescript
interface WorkerRuntimeStatus {
  name: string;
  concurrency: number;
  started: boolean;
  ready: boolean;
  lastStartedAt?: string;
  lastReadyAt?: string;
  lastStoppedAt?: string;
  lastError?: string;
  lastSuccessfulRunAt?: string;
  lastErrorAt?: string;
  schedulerRegistered: boolean;
}
```

**Access via API:**

```bash
GET /api/v1/system/status
```

**Response:**

```json
{
  "workers": {
    "portfolioCheck": {
      "name": "portfolio-check",
      "concurrency": 2,
      "started": true,
      "ready": true,
      "lastSuccessfulRunAt": "2025-01-15T10:30:00Z",
      "lastError": null
    },
    "rebalance": {
      "name": "rebalance",
      "concurrency": 1,
      "started": true,
      "ready": true,
      "lastSuccessfulRunAt": "2025-01-15T10:25:00Z",
      "lastError": null
    }
  }
}
```

### Queue Health

Check queue and Redis connectivity:

```bash
GET /api/v1/queue/health
```

**Response:**

```json
{
  "redis": {
    "connected": true,
    "url": "redis://localhost:6379"
  },
  "queues": {
    "portfolio-check": {
      "waiting": 0,
      "active": 1,
      "completed": 1234,
      "failed": 5
    },
    "rebalance": {
      "waiting": 2,
      "active": 0,
      "completed": 567,
      "failed": 2
    }
  }
}
```

### Readiness Probe

Use `/ready` to check if workers are healthy:

```bash
GET /api/v1/ready
```

Returns `503` if any worker is not ready. Use this for load balancer health checks.

---

## Troubleshooting

### Jobs Not Processing

**Symptom:** Jobs accumulate in WAITING state

**Causes:**

1. Workers not started
2. Redis unavailable
3. Worker crashed

**Fix:**

```bash
# Check Redis connectivity
redis-cli ping

# Check worker status
curl http://localhost:3001/api/v1/system/status

# Restart workers
npm run workers:dedicated
```

### Jobs Failing Repeatedly

**Symptom:** Jobs exhaust retries and fail

**Causes:**

1. Transient error (network, database timeout)
2. Permanent error (invalid data, missing resource)
3. Worker bug

**Fix:**

```bash
# Check worker logs
tail -f logs/worker.log

# Inspect failed job
redis-cli
> HGETALL bull:rebalance:failed:job-id

# Manually retry (if safe)
curl -X POST http://localhost:3001/api/v1/admin/jobs/retry \
  -H "X-Admin-Key: ..." \
  -d '{"jobId": "job-id", "queue": "rebalance"}'
```

### Worker Memory Leak

**Symptom:** Worker process memory grows over time

**Causes:**

1. Event listeners not cleaned up
2. Circular references in job data
3. Large result objects not garbage collected

**Fix:**

```typescript
// In worker cleanup
worker.on("close", () => {
  // Remove all listeners
  worker.removeAllListeners();

  // Clear caches
  cache.clear();
});
```

---

## Common Patterns

### Enqueue Job from API

```typescript
import { getRebalanceQueue } from "../queue/queues";

router.post("/api/portfolio/:id/rebalance", async (req, res) => {
  const queue = getRebalanceQueue();

  if (!queue) {
    return res.status(503).json({ error: "Queue unavailable" });
  }

  const job = await queue.add(
    "rebalance",
    {
      portfolioId: req.params.id,
      triggeredBy: "manual",
      correlationId: req.id,
    },
    {
      jobId: `rebalance-${req.params.id}-${Date.now()}`,
      removeOnComplete: true,
    },
  );

  res.json({ jobId: job.id, status: "queued" });
});
```

### Handle Job Failure

```typescript
worker.on("failed", (job, error) => {
  logger.error("[WORKER] Job failed", {
    jobId: job.id,
    queue: job.queueName,
    attempt: job.attemptsMade,
    maxAttempts: job.opts.attempts,
    error: error.message,
  });

  // Notify user if manual trigger
  if (job.data.triggeredBy === "manual") {
    notificationService.sendJobFailedNotification(job.data.userId, error);
  }
});
```

### Retry with Backoff

```typescript
// Exponential backoff is automatic, but you can customize:
const job = await queue.add(
  "rebalance",
  { portfolioId: "123" },
  {
    attempts: 10, // More retries
    backoff: {
      type: "exponential",
      delay: 2000, // Start with 2s instead of 5s
    },
  },
);
```

---

## Related Documentation

- [Operations handbook](../docs/OPERATIONS.md) — Redis, health checks, shutdown procedures
- [Backend environment variables](../docs/ENVIRONMENT.md) — queue configuration
- [BullMQ documentation](https://docs.bullmq.io/) — queue library reference

---

## Maintenance Notes

- **Monitor queue depth** — if WAITING jobs accumulate, workers may be overloaded
- **Tune concurrency** — increase for I/O-bound jobs, decrease for CPU-bound jobs
- **Review retry policy** — adjust delays if jobs fail due to transient errors
- **Clean up old jobs** — Redis memory grows if job retention is too long
- **Test graceful shutdown** — ensure workers finish current jobs before exiting
