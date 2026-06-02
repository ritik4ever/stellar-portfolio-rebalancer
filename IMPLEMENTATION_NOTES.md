# Implementation Summary: Issues #448 and #450

## Issue #448: Harden WebSocket handshake authorization and expiry rules

### Problem
WebSocket connections were not validated with JWT tokens during the handshake, and sessions could outlive their HTTP session auth guarantees by continuing indefinitely without token expiry checks.

### Solution
Implemented hardened WebSocket authorization that enforces JWT validation on connection and continuously validates token expiry during the session lifecycle.

### Changes Made

#### 1. **[backend/src/types/websocket.ts](backend/src/types/websocket.ts)**
- Added `WSSessionMetadata` interface to track:
  - `userId`: Authenticated user from JWT
  - `authenticatedAt`: Connection auth timestamp
  - `tokenExpiresAt`: When JWT expires (ISO 8601)
  - `tokenExpiryTimestamp`: Unix timestamp for efficient comparisons

#### 2. **[backend/src/middleware/requireJwt.ts](backend/src/middleware/requireJwt.ts)**
- Added `verifyAccessTokenForWebSocket()` function to extract and validate JWT tokens
- Returns token payload with expiry information for WebSocket initialization
- Supports token rotation grace period (existing feature)
- Distinguishes error types: `'expired'`, `'invalid'`, `'missing_secret'`

#### 3. **[backend/src/services/websocket.service.ts](backend/src/services/websocket.service.ts)**
- Enhanced WebSocket initialization with hardened handshake:
  - Validates JWT token from Authorization header or query parameter
  - Extracts token expiry and stores in `WSSessionMetadata`
  - Sends session metadata in connection message for client awareness
  
- Added token expiry enforcement in heartbeat loop:
  - Checks expiry every 30 seconds
  - Closes connections with code 1008 (Policy Violation) when token expires
  - Closes with actionable message: `Token expired at {ISO_TIMESTAMP}`
  
- Enhanced message handling:
  - Re-validates token expiry on each message reception
  - Closes connection if token has expired mid-session
  - Logs all auth failures and disconnections with user context
  
- Backward compatibility:
  - When auth is disabled (dev/test mode), accepts query param `userId`
  - Falls back gracefully when auth config is not enabled

### Acceptance Criteria Met
✅ API behavior is reachable through intended code path
✅ Failure cases return actionable responses (close codes, error messages)
✅ Automated coverage added via `backend/src/test/websocket.auth.test.ts`

### Test Coverage
New test file: **[backend/src/test/websocket.auth.test.ts](backend/src/test/websocket.auth.test.ts)**
- Tests with auth enabled:
  - Rejects connection without token
  - Accepts valid token in Authorization header
  - Accepts valid token in query parameter
  - Rejects expired tokens
  - Rejects invalid tokens
  - Includes expiry info in metadata
  - Closes connection on token expiration during session
  - Validates token on message reception
  
- Tests with auth disabled:
  - Accepts connection without token
  - Backward compatibility with query param `userId`

---

## Issue #450: Persist worker heartbeat and status for ops visibility

### Problem
Operators could not see which workers were alive, idle, lagging, or unhealthy without reading logs. Worker status was only stored in memory and unavailable through ops endpoints.

### Solution
Implemented Redis-backed worker heartbeat persistence with ops-friendly endpoints and Prometheus metrics.

### Changes Made

#### 1. **New Service: [backend/src/queue/workers/workerHeartbeat.ts](backend/src/queue/workers/workerHeartbeat.ts)**
Provides Redis-backed persistence layer for worker status:

**Data Model:**
- `PersistedWorkerStatus`: Extends `WorkerRuntimeStatus` with:
  - `persistedAt`: Timestamp of last status update
  - `heartbeatAt`: Timestamp of last heartbeat refresh
  - `isHealthy`: Boolean flag (true if updated within 120s TTL)

**Core Functions:**
- `persistWorkerStatus(status)`: Write status to Redis with 120s TTL
- `getAllPersistedWorkerStatuses()`: Retrieve all workers with health flags
- `getPersistedWorkerStatus(name)`: Get single worker status
- `updateWorkerHeartbeat(name)`: Refresh entry without changing status
- `clearAllWorkerStatus()`: Cleanup on shutdown
- `getWorkerHealthSummary()`: Compute aggregated health metrics

**Health Summary Metrics:**
- `total`: Number of workers
- `healthy`: Ready workers with recent heartbeat
- `unhealthy`: Workers with errors or stale status
- `idle`: Ready workers without recent errors
- `lagging`: Workers with last job >5 minutes ago

#### 2. **[backend/src/queue/workers/workerRuntime.ts](backend/src/queue/workers/workerRuntime.ts)**
- Imported heartbeat persistence functions
- Updated all status update functions to persist to Redis:
  - `markWorkerStarting()` → `persistWorkerStatus()`
  - `markWorkerReady()` → `persistWorkerStatus()`
  - `markWorkerFailed()` → `persistWorkerStatus()`
  - `markWorkerStopped()` → `persistWorkerStatus()`
  - `markWorkerJobCompleted()` → `persistWorkerStatus()`
  - `markWorkerJobFailed()` → `persistWorkerStatus()`
  - `setSchedulerRegistered()` → `persistWorkerStatus()`

#### 3. **[backend/src/api/ops.routes.ts](backend/src/api/ops.routes.ts)**
- Added imports for worker heartbeat persistence functions
- New endpoint: **GET /api/workers/health**
  - Returns aggregated worker health summary
  - Status code 200 when healthy, 503 when unhealthy
  - Response includes breakdown: `total`, `healthy`, `unhealthy`, `idle`, `lagging`
  - Full `workers` array with detailed per-worker status
  
- New endpoint: **GET /api/workers/status**
  - Returns detailed persisted status for all workers
  - Useful for dashboards and monitoring systems
  - Includes all metadata: timestamps, errors, scheduler registration

#### 4. **[backend/src/observability/metrics.ts](backend/src/observability/metrics.ts)**
- Added worker health Prometheus metrics:
  - `app_worker_health_total`: Total number of workers
  - `app_worker_healthy_total`: Number of healthy workers
  - `app_worker_unhealthy_total`: Number of unhealthy workers
  - `app_worker_idle_total`: Number of idle workers
  - `app_worker_lagging_total`: Number of lagging workers
  - `app_worker_status`: Per-worker status (1=ready, 0=not ready)

- Updated `getMetricsPayload()` to:
  - Query worker health summary
  - Populate metrics on each scrape
  - Per-worker status labels for alerting

### Acceptance Criteria Met
✅ API behavior is reachable through intended code path (`GET /api/workers/health`, `GET /api/workers/status`)
✅ Failure cases return actionable responses (health status codes, error details)
✅ Automated coverage added via `backend/src/test/workerHeartbeat.test.ts`

### Test Coverage
New test file: **[backend/src/test/workerHeartbeat.test.ts](backend/src/test/workerHeartbeat.test.ts)**
- Persistence layer tests:
  - Status persisted with metadata
  - Multiple workers stored independently
  - Error messages preserved
  
- Health tracking tests:
  - All statuses retrieved
  - Recently updated marked as healthy
  - Stale statuses expire after TTL
  
- Heartbeat refresh tests:
  - Updates timestamp without changing state
  - Extends Redis TTL
  
- Health summary tests:
  - Aggregates metrics correctly
  - Identifies lagging workers
  - Handles empty state
  
- Ops visibility scenarios:
  - Real-time health dashboard data available
  - Worker failures detected and persisted
  - Error messages accessible to operators

### API Examples

#### Get Worker Health Summary
```bash
GET /api/workers/health

Response (200 OK):
{
  "timestamp": "2026-01-01T00:00:00.000Z",
  "summary": {
    "total": 3,
    "healthy": 2,
    "unhealthy": 1,
    "idle": 2,
    "lagging": 0
  },
  "workers": [
    {
      "name": "portfolio-check",
      "started": true,
      "ready": true,
      "isHealthy": true,
      "lastSuccessfulRunAt": "2026-01-01T00:00:00.000Z",
      ...
    },
    ...
  ]
}
```

#### Get Detailed Worker Status
```bash
GET /api/workers/status

Response (200 OK):
{
  "timestamp": "2026-01-01T00:00:00.000Z",
  "workers": [
    {
      "name": "portfolio-check",
      "concurrency": 1,
      "started": true,
      "ready": true,
      "lastReadyAt": "2026-01-01T00:00:00.000Z",
      "persistedAt": "2026-01-01T00:00:00.000Z",
      "heartbeatAt": "2026-01-01T00:00:00.000Z",
      "isHealthy": true
    },
    ...
  ]
}
```

### Prometheus Metrics
```
# Worker health metrics
app_worker_health_total 3
app_worker_healthy_total 2
app_worker_unhealthy_total 1
app_worker_idle_total 2
app_worker_lagging_total 0

# Per-worker status
app_worker_status{worker_name="portfolio-check"} 1
app_worker_status{worker_name="rebalance"} 0
app_worker_status{worker_name="analytics-snapshot"} 1
```

---

## Architecture Decisions

### Why Redis for Persistence?
- Already available in production (used by BullMQ)
- TTL feature allows automatic cleanup without manual maintenance
- Fast enough for ops dashboards and alerting
- Survives worker crashes (but not server restarts)

### Why 120-second TTL?
- Longer than heartbeat interval (30s) to handle transient delays
- Short enough to quickly show stale workers on dashboards
- Allows operators to see failure within 2 minutes

### Why Policy Violation (1008) for WebSocket Closure?
- RFC 6455 Standard code for authentication/authorization failures
- Distinct from normal closure (1000) or connection errors
- Clients can implement retry logic based on code

---

## Future Enhancements

### For Issue #448:
- Token refresh/rotation support (pre-expire before socket close)
- Rate limiting on failed auth attempts
- WebSocket-specific JWT claims (e.g., scope validation)

### For Issue #450:
- Worker performance metrics (jobs/sec, avg duration)
- Persistent worker status database for long-term trending
- Alert rules based on worker health
- Dashboard widget for worker status
