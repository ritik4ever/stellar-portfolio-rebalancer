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

## Public Connectivity Status (oracle + DEX)

Unauthenticated report on the Reflector oracle and the Stellar DEX behind the public status page, built from live probes rather than a static claim. Always answers `200` — the body carries the health — and results are cached for `PUBLIC_STATUS_CACHE_TTL_MS` (default 15s).

```bash
curl -s "$API_BASE/api/v1/status" | jq
```

Expected response (when healthy):
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2024-01-01T00:00:00.000Z",
    "checks": {
      "reflector_oracle": {
        "status": "ok",
        "last_checked": "2024-01-01T00:00:00.000Z",
        "latency_ms": 84,
        "reason": "ok",
        "message": "Reflector oracle is reachable and serving fresh quotes."
      },
      "stellar_dex": {
        "status": "ok",
        "last_checked": "2024-01-01T00:00:00.000Z",
        "latency_ms": 132,
        "reason": "ok",
        "message": "Stellar DEX is reachable and quoting the probed pair."
      }
    },
    "cache": { "cached": false, "age_ms": 0, "ttl_ms": 15000 }
  }
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
