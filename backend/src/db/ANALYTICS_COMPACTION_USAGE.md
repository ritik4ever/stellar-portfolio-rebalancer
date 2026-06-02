# Analytics Snapshot Compaction Feature

## Overview

This feature automatically compacts historical analytics snapshots to reduce database storage costs while preserving data integrity for both recent analysis and long-term trend tracking.

## Problem Statement

The analytics system captures portfolio snapshots (hourly by default) to track performance metrics. Without compaction, this data grows indefinitely:

- **Scenario**: 1 portfolio with 1 snapshot/hour
- **After 1 year**: 8,760 snapshots
- **After 5 years**: 43,800 snapshots
- **After 10 years**: 87,600 snapshots

This leads to:

- Increased database storage costs
- Slower queries on large result sets
- Query timeouts during analytics aggregation

## Solution

A tiered retention policy that:

1. **Preserves recent data** (0-7 days): All snapshots for detailed analysis
2. **Rolls up intermediate data** (7-90 days): Keep last snapshot per day
3. **Deletes old data** (90+ days): Remove entirely

## Architecture

### Components

```
┌─────────────────────┐
│  BullMQ Scheduler   │  Runs every Sunday @ 02:00 UTC
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ analytics-compaction│  Queue with repeatable job
│      Queue          │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│    Worker Thread    │  Processes compaction job
│ (concurrency: 1)    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────┐
│  AnalyticsService               │
│  .compactAllPortfolios()        │
│  .compactAnalyticsForPortfolio()│
└──────────┬──────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│  Database                        │
│  dbCompactAnalyticsSnapshots()   │
│  - Phase 1: Delete old           │
│  - Phase 2: Keep last-per-day    │
└──────────────────────────────────┘
```

### Data Flow

1. **Scheduler** (Sunday 02:00 UTC): Creates a job in the `analytics-compaction` queue
2. **Worker** retrieves job and calls `analyticsService.compactAllPortfolios()`
3. **Service** iterates all portfolios and calls `compactAnalyticsForPortfolio()`
4. **Database** executes two-phase compaction SQL
5. **Metrics** logged: portfolios processed, snapshots deleted/retained

## Usage

### Automatic Execution

The compaction runs automatically on schedule:

```bash
# Runs every Sunday at 02:00 UTC
Cron: 0 2 * * 0
```

### Manual Execution (Development/Testing)

```typescript
import { analyticsService } from "./services/analyticsService.js";

// Compact a single portfolio
const stats = await analyticsService.compactAnalyticsForPortfolio(
  "portfolio-id",
  90, // Delete snapshots > 90 days old
  7, // Keep full resolution for last 7 days
);

// Compact all portfolios
const allStats = await analyticsService.compactAllPortfolios(90, 7);

// Returns: CompactionStats[]
// [
//   {
//     portfolioId: 'portfolio-1',
//     deletedCount: 100,
//     retainedCount: 50,
//     compactionCutoffTimestamp: '2026-02-02T02:00:00.000Z'
//   },
//   ...
// ]
```

## Configuration

### Default Parameters

| Parameter    | Default | Description                            |
| ------------ | ------- | -------------------------------------- |
| `cutoffDays` | 90      | Delete snapshots older than this       |
| `recentDays` | 7       | Retain full resolution for this period |

### Schedule

```typescript
// Cron pattern in scheduler.ts
const ANALYTICS_COMPACTION_CRON = "0 2 * * 0"; // Every Sunday at 02:00 UTC
```

To modify schedule, edit `backend/src/queue/scheduler.ts`:

```typescript
// Change to daily at midnight UTC
const ANALYTICS_COMPACTION_CRON = "0 0 * * *";
```

## Implementation Details

### Database Strategy

The compaction uses a two-phase SQL approach:

**Phase 1: Delete Old Data**

```sql
DELETE FROM analytics_snapshots
WHERE portfolio_id = $1
  AND timestamp < NOW() - INTERVAL '1 day' * $2;
```

**Phase 2: Keep Last-Per-Day for Intermediate Range**

This uses a two-step SQL approach in implementation (the CTE is used internally):

```sql
WITH daily_snapshots AS (
  SELECT DISTINCT ON (DATE(timestamp)) id
  FROM analytics_snapshots
  WHERE portfolio_id = $1
    AND timestamp >= NOW() - INTERVAL '1 day' * $3
    AND timestamp < NOW() - INTERVAL '1 day' * $2
  ORDER BY DATE(timestamp), timestamp DESC
)
DELETE FROM analytics_snapshots
WHERE portfolio_id = $1
  AND timestamp >= NOW() - INTERVAL '1 day' * $3
  AND timestamp < NOW() - INTERVAL '1 day' * $2
  AND id NOT IN (SELECT id FROM daily_snapshots);
```

**Note**: In the actual implementation (see `backend/src/db/analyticsDb.ts`), these are executed as separate parameterized queries for safety and compatibility.

### Service Methods

**`analyticsService.compactAnalyticsForPortfolio()`**

- Compacts one portfolio
- Validates parameters
- Calls database function
- Returns stats
- Logs with correlation ID

**`analyticsService.compactAllPortfolios()`**

- Iterates all portfolios
- Calls single-portfolio compaction
- Aggregates results
- Logs summary stats

### Worker Implementation

**File**: `backend/src/queue/workers/analyticsCompactionWorker.ts`

```typescript
export async function processAnalyticsCompactionJob(
  job: Job<AnalyticsCompactionJobData>,
): Promise<void>;

export function startAnalyticsCompactionWorker(): Worker | null;
export async function stopAnalyticsCompactionWorker(): Promise<void>;
export function getAnalyticsCompactionWorkerStatus(): WorkerRuntimeStatus;
```

## Monitoring & Observability

### Readiness Check

The `/readiness` endpoint includes analytics-compaction status:

```json
{
  "status": "ready",
  "checks": {
    "database": {...},
    "redis": {...},
    "queues": {
      "analytics-compaction": {
        "status": "ready",
        "message": "analytics-compaction queue is ready"
      }
    },
    "workers": {
      "analyticsCompaction": {
        "name": "analytics-compaction",
        "started": true,
        "ready": true,
        "schedulerRegistered": true
      }
    }
  }
}
```

### Logs

**Compaction Start** (INFO):

```text
[WORKER:analytics-compaction] Starting analytics snapshot compaction
  jobId: job-123
  triggeredBy: scheduler
  cutoffDays: 90
  recentDays: 7
  correlationId: corr-abc123
```

**Per-Portfolio** (INFO):

```text
[ANALYTICSSERVICE] Analytics snapshots compacted for portfolio
  portfolioId: portfolio-1
  deletedCount: 100
  retainedCount: 50
  cutoffDays: 90
  recentDays: 7
```

**Completion** (INFO):

```text
[WORKER:analytics-compaction] Compaction cycle complete
  jobId: job-123
  portfoliosProcessed: 5
  totalSnapshotsDeleted: 450
  totalSnapshotsRetained: 250
```

**Errors** (ERROR):

```text
[ANALYTICSSERVICE] Failed to compact analytics snapshots for portfolio
  portfolioId: portfolio-2
  error: "Database connection timeout"
```

### Metrics

Track via logs or instrumentation:

- Compaction frequency (should be 1x/week)
- Snapshots deleted per cycle
- Snapshots retained per portfolio
- Compaction duration
- Error rate

## Example Scenario

### Before Compaction

Portfolio `ABC-123` over 100 days:

- Days 1-7 (recent): 168 snapshots (1/hour)
- Days 8-90: 1,968 snapshots (1/hour each day)
- Days 91-100: 240 snapshots (1/hour)
- **Total**: 2,376 snapshots

### Compaction Run (cutoffDays=90, recentDays=7)

1. Delete all snapshots from days 91-100 (240 snapshots)
2. For days 8-90, keep only last snapshot per day (83 snapshots)
3. Keep all recent snapshots (days 1-7: 168 snapshots)

### After Compaction

- Recent data (7 days): 168 snapshots
- Historical data (7-90 days): 83 snapshots (daily)
- Old data (90+ days): 0 snapshots (deleted)
- **Total**: 251 snapshots

**Storage Reduction**: 89.4% (2,376 → 251)

## Testing

### Unit Tests

**File**: `backend/src/test/analyticsCompaction.test.ts`

Tests for `analyticsService`:

- Correct database calls with parameters
- Default parameter handling
- Parameter validation
- Error handling
- Multi-portfolio aggregation

**File**: `backend/src/test/analyticsCompactionWorker.test.ts`

Tests for worker processor:

- Correct service calls
- Parameter passthrough
- Error propagation
- Empty result handling

### Running Tests

```bash
npm run test -- analyticsCompaction
npm run test -- analyticsCompactionWorker
```

## Error Handling

### Common Errors

| Error                              | Cause                | Resolution                  |
| ---------------------------------- | -------------------- | --------------------------- |
| "cutoffDays must be >= recentDays" | Invalid parameters   | Check parameters            |
| "Database connection failed"       | Connection issue     | Check database connectivity |
| "Portfolio not found"              | Invalid portfolio ID | Verify portfolio exists     |
| "Redis unavailable"                | Queue system down    | Check Redis connection      |

### Retry Logic

- **Exponential backoff**: 5s → 10s → 20s → 40s → 80s
- **Max retries**: 5 attempts
- **On failure**: Job moved to dead letter queue, logged as error

## Files Modified

| File                                                     | Changes                                                          |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| `backend/src/db/analyticsDb.ts`                          | Added `dbCompactAnalyticsSnapshots()`                            |
| `backend/src/services/analyticsService.ts`               | Added `compactAnalyticsForPortfolio()`, `compactAllPortfolios()` |
| `backend/src/queue/queues.ts`                            | Added `analytics-compaction` queue and job data type             |
| `backend/src/queue/workers/analyticsCompactionWorker.ts` | **NEW**: Worker implementation                                   |
| `backend/src/queue/scheduler.ts`                         | Added compaction job scheduling                                  |
| `backend/src/monitoring/readiness.ts`                    | Added health checks                                              |
| `backend/src/config/startupConfig.ts`                    | Updated startup logging                                          |

## Future Enhancements

- [ ] Configurable retention per portfolio
- [ ] Archive to cold storage (S3) instead of delete
- [ ] Rollup statistics instead of sampling
- [ ] Admin API endpoint for manual compaction
- [ ] Dashboard metrics for compaction effectiveness
- [ ] Gradual compaction (spread across multiple runs)

## Troubleshooting

### Compaction Not Running

1. Check Redis is available: `redis-cli ping`
2. Check worker is started: `/api/v1/system/status`
3. Check scheduler is registered: See logs for `[SCHEDULER]`
4. Check cron time: Current time vs `0 2 * * 0` schedule

### Excessive Storage Usage

1. Check retention parameters (may be too conservative)
2. Check snapshots are being created (should be hourly)
3. Check for failed compaction jobs
4. Manually trigger compaction if needed

### Performance Issues

1. Compaction running during peak hours? Reschedule to off-peak
2. Too many portfolios? Run compaction more frequently
3. Large snapshots? Check balances/allocations data size

## Support

For issues or questions:

1. Check logs for error details
2. Verify database connectivity
3. Check Redis availability
4. Review this documentation
5. File an issue with logs and correlation ID
