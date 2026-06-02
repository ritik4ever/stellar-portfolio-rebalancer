# Analytics Snapshot Compaction

## Overview

The analytics snapshot compaction feature reduces long-term storage costs by managing the accumulation of historical analytics data. High-frequency snapshots (e.g., every hour) are useful for recent analysis but become redundant when rolled up into daily aggregates for longer-term storage.

## Strategy

The compaction process operates on a tiered approach:

1. **Recent Data (Last 7 days by default)**: All snapshots retained at full resolution for detailed analysis
2. **Historical Data (7-90 days)**: Keep only the last snapshot per day to preserve trend data
3. **Old Data (90+ days)**: Deleted entirely to reclaim storage

### Retention Configuration

- **`recentDays`** (default: 7): Number of days to retain full-frequency snapshots
- **`cutoffDays`** (default: 90): Number of days before deletion threshold

Constraint: `cutoffDays >= recentDays` is enforced

## Execution Schedule

The compaction job runs automatically via BullMQ scheduler:

- **Frequency**: Every Sunday at 02:00 UTC
- **Cron Pattern**: `0 2 * * 0`
- **Concurrency**: Single worker (sequential per portfolio)

Manual execution is also available via the analytics service:

```typescript
const stats = await analyticsService.compactAnalyticsForPortfolio(
  portfolioId,
  (cutoffDays = 90),
  (recentDays = 7),
);
// or
const allStats = await analyticsService.compactAllPortfolios(90, 7);
```

## Database Operations

The `dbCompactAnalyticsSnapshots()` function handles the SQL logic:

1. **Phase 1**: Delete all snapshots older than `cutoffDays`
2. **Phase 2**: For snapshots in the intermediate range (between `cutoffDays` and `recentDays`), keep only the last snapshot per day using `DISTINCT ON (DATE(timestamp))`

### SQL Strategy

```sql
-- Phase 1: Delete old snapshots
DELETE FROM analytics_snapshots
WHERE portfolio_id = $1
  AND timestamp < NOW() - INTERVAL '1 day' * $2;

-- Phase 2: Keep last-of-day for intermediate range
WITH daily_snapshots AS (
  SELECT DISTINCT ON (DATE(timestamp)) id
  FROM analytics_snapshots
  WHERE portfolio_id = $1
    AND timestamp >= NOW() - INTERVAL '1 day' * $2
    AND timestamp < NOW() - INTERVAL '1 day' * $3
  ORDER BY DATE(timestamp), timestamp DESC
)
DELETE FROM analytics_snapshots
WHERE portfolio_id = $1
  AND timestamp >= NOW() - INTERVAL '1 day' * $2
  AND timestamp < NOW() - INTERVAL '1 day' * $3
  AND id NOT IN (SELECT id FROM daily_snapshots);
```

## Metrics and Logging

Each compaction produces:

```typescript
interface CompactionStats {
  portfolioId: string;
  deletedCount: number; // Snapshots removed
  retainedCount: number; // Snapshots remaining
  compactionCutoffTimestamp: string;
}
```

**Logs**:

- **INFO**: Start/completion of compaction cycle with summary (total portfolios, deleted/retained counts)
- **ERROR**: Failures with portfolio ID and error details

## Worker & Queue

### Queue Configuration

- **Queue Name**: `analytics-compaction`
- **Job Type**: `AnalyticsCompactionJobData`
- **Data Fields**:
  - `triggeredBy`: "scheduler" | "manual"
  - `correlationId?`: Request tracking ID
  - `cutoffDays?`: Override default (90)
  - `recentDays?`: Override default (7)

### Worker

Worker file: `backend/src/queue/workers/analyticsCompactionWorker.ts`

- **Processor**: `processAnalyticsCompactionJob()`
- **Start Function**: `startAnalyticsCompactionWorker()`
- **Status Function**: `getAnalyticsCompactionWorkerStatus()`
- **Concurrency**: 1 (one portfolio at a time)

## API & Ops Integration

### Readiness Check

The `/readiness` endpoint includes:

- Queue health: `QUEUE_NAMES.ANALYTICS_COMPACTION`
- Worker status: `analyticsCompaction`

### System Status

The `/api/v1/system/status` endpoint includes analytics-compaction worker runtime status in the `workers` section.

## Testing

### Unit Tests

File: `backend/src/test/analyticsCompaction.test.ts`

Test coverage:

- Correct database function calls with parameters
- Default parameter handling
- Validation (cutoffDays >= recentDays)
- Multi-portfolio aggregation
- Error handling and recovery
- Statistics aggregation

### Integration Testing

1. **Manual Trigger** (development):

   ```typescript
   // Direct service call from test or script
   import { analyticsService } from './services/analyticsService.js';
   
   const stats = await analyticsService.compactAllPortfolios(90, 7);
   console.log('Compaction complete:', stats);
   ```

   Or via queue injection (testing only):

   ```typescript
   const queue = getAnalyticsCompactionQueue();
   await queue?.add('manual-compaction', { 
       triggeredBy: 'manual',
       cutoffDays: 90,
       recentDays: 7 
   });
   ```

2. **Scheduler Test**:
   - Run automated tests with mocked Redis
   - Verify job enqueued at correct cron interval

3. **Data Integrity**:
   - Snapshot counts before/after
   - Verify retention policy (last-of-day logic)
   - No data loss during intermediate range compaction

## Error Handling

### Failure Cases & Recovery

| Scenario                     | Behavior                          | Log Level  |
| ---------------------------- | --------------------------------- | ---------- |
| Database unavailable         | Job retries (exponential backoff) | WARN/ERROR |
| Portfolio with 0 snapshots   | Skipped (no-op)                   | INFO       |
| Parameter validation failure | Job rejected immediately          | ERROR      |
| Partial portfolio failure    | Stops at first error              | ERROR      |

### Logging

All errors include:

- Portfolio ID (if portfolio-specific)
- Error message/stack
- Correlation ID for request tracing

## Monitoring & Alerts

### Metrics to Track

- Compaction frequency (should run weekly)
- Average snapshots deleted per portfolio
- Compaction duration (should be < 5 minutes for typical load)
- Storage reclamation (disk space freed)

### Alert Conditions

- Compaction fails 3+ times in a row
- Compaction takes > 10 minutes
- Retention rate too high (< 50% deletion suggests issues)

## Example Scenario

**Initial State**:

- Portfolio `ABC-123` has 168 hourly snapshots (7 days: 24 * 7)
- Plus 1,968 hourly snapshots from days 8-90 (83 days: 24 * 83)
- Plus 240 hourly snapshots from days 91-100 (10 days old, beyond cutoff)
- Total: 2,376 snapshots

**After Compaction** (cutoffDays=90, recentDays=7):

- Delete 240 (beyond 90-day cutoff)
- Keep 168 recent snapshots (days 1-7, full resolution)
- In 7-90 range: Reduce to 83 daily snapshots (one per day)
- Result: ~251 snapshots retained (~89.4% storage reduction)

## Future Enhancements

- [ ] Configurable retention policy per portfolio
- [ ] Archive to cold storage (S3/GCS) instead of delete
- [ ] Rollup statistics (min/max/avg) instead of sampling
- [ ] Admin API endpoint for manual trigger
- [ ] Compaction metrics dashboard
