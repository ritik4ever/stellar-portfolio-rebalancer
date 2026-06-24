# Health & System Status

Basic health checks and system status monitoring.

## Simple Health Check

```bash
curl -s "$API_BASE/health"
```

Expected response:
```
ok
```

## API Health Check (JSON)

```bash
curl -s "$API_BASE/api/health" | jq
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Readiness Check

Checks database, Redis/queues, workers, and indexer status.

```bash
curl -s "$API_BASE/readiness" | jq
```

Expected response (when ready):
```json
{
  "status": "ready",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "dependencies": {
    "database": "ready",
    "redis": "ready",
    "workers": "ready",
    "indexer": "ready"
  }
}
```

## System Status

Comprehensive system status including portfolio count and history stats.

```bash
curl -s "$API_BASE/api/v1/system/status" | jq
```

## Queue Health

Check BullMQ queue metrics and worker status.

```bash
curl -s "$API_BASE/api/v1/queue/health" | jq
```

## Worker Health

Check worker health summary.

```bash
curl -s "$API_BASE/api/v1/workers/health" | jq
```

## Worker Status

Get detailed status of all workers.

```bash
curl -s "$API_BASE/api/v1/workers/status" | jq
```

## Contract Event Indexer Cursor

Get the current indexer cursor and status.

```bash
curl -s "$API_BASE/api/v1/indexer/cursor" | jq
```

## Available Rebalancing Strategies

List available rebalancing strategies.

```bash
curl -s "$API_BASE/api/v1/strategies" | jq
```
