# Structured Log Fields

## Correlation Keys

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `requestId` | string | Unique request identifier | `req_abc123` |
| `sessionId` | string | Session identifier | `sess_xyz789` |
| `userId` | string | Authenticated user ID | `user_456` |
| `traceId` | string | Distributed trace ID | `trace_def` |

## Request Log Fields

| Field | Type | Description |
|-------|------|-------------|
| `method` | string | HTTP method |
| `path` | string | Request path |
| `status` | number | HTTP status code |
| `durationMs` | number | Request duration in ms |
| `ip` | string | Client IP address |

## Error Log Fields

| Field | Type | Description |
|-------|------|-------------|
| `error` | string | Error message |
| `code` | string | Error code |
| `stack` | string | Stack trace (development only) |

## Business Log Fields

| Field | Type | Description |
|-------|------|-------------|
| `portfolioId` | string | Portfolio being modified |
| `action` | string | Action performed (rebalance, create, update) |
| `asset` | string | Asset code (XLM, USDC) |
| `amount` | number | Transaction amount |
