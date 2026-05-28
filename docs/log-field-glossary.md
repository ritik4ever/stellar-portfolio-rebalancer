# Structured Log Fields

This document describes the structured log fields used across the Stellar Portfolio Rebalancer and the required correlation keys for tracing requests.

## Log Format

All logs are emitted in JSON format for structured consumption:

```json
{
  "level": "info",
  "timestamp": "2026-05-28T10:00:00.000Z",
  "message": "Rebalance completed",
  "service": "backend",
  "requestId": "req_abc123"
}
```

## Required Correlation Keys

Every log entry **must** include at minimum:

| Key | Type | Description | Example |
|-----|------|-------------|---------|
| `requestId` | string | Unique request identifier | `req_abc123` |
| `timestamp` | string | ISO 8601 UTC timestamp | `2026-05-28T10:00:00.000Z` |
| `level` | string | Log level | `info`, `warn`, `error`, `debug` |
| `service` | string | Service name | `backend`, `frontend`, `indexer` |
| `message` | string | Human-readable log message | `Rebalance triggered` |

## Optional Context Fields

| Key | Type | Description | Example |
|-----|------|-------------|---------|
| `portfolioId` | string | Portfolio being acted upon | `portfolio_123` |
| `asset` | string | Asset symbol | `XLM` |
| `duration` | number | Operation duration in ms | `245` |
| `error` | object | Error details | `{ "message": "...", "stack": "..." }` |
| `userId` | string | Authenticated user reference | `G...` |

## Best Practices

- Always include `requestId` — generate a UUID for every incoming request
- Log at `error` level for operational failures, `warn` for recoverable issues
- Use lowercase keys consistently
- Never log secrets, private keys, or personal data
