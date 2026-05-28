## Structured Log Fields Reference

The backend emits structured JSON logs via **Pino**. Every log line follows a consistent schema for easy ingestion into Loki, Elasticsearch, or any JSON-capable log aggregator.

### Log line structure

```jsonc
{
  // --- Pino standard fields ---
  "level": "info",              // Log level label: trace, debug, info, warn, error, fatal
  "time": "2026-05-28T09:00:00.000Z",  // ISO 8601 timestamp
  "pid": 12345,                 // Process ID
  "hostname": "server-1",       // Machine hostname

  // --- Application base fields ---
  "service": "stellar-portfolio-backend",  // Always present
  "environment": "production",             // NODE_ENV value

  // --- Correlation ---
  "requestId": "abc-123-def",   // Async-local request ID (present in HTTP request context)
  "spanId": "xyz-789",          // New Relic span ID (when New Relic enabled)

  // --- Message ---
  "msg": "Portfolio rebalance executed successfully",  // Human-readable message

  // --- Per-event fields (vary by log site) ---
  "portfolioId": "port_abc123",
  "userId": "GA...",
  "rebalanceDuration": 2450,    // ms
  "tradesExecuted": 3,
  "totalValue": 12430.50,

  // --- Error fields ---
  "err": {
    "type": "SlippageExceededError",
    "message": "Slippage 3.2% exceeds tolerance 1.0%",
    "stack": "SlippageExceededError: ..."
  }
}
```

### Log levels and when to use them

| Level | Use case | Example |
| ----- | -------- | ------- |
| `fatal` | Service cannot continue | Database connection lost on startup |
| `error` | Recoverable failure that needs investigation | Rebalance execution failed, API rate limit exceeded |
| `warn` | Unexpected but non-critical | Slippage near tolerance, stale price data |
| `info` | Normal operational events | Portfolio created, rebalance started/completed, user logged in |
| `debug` | Detailed diagnostic info | Request body, intermediate calculation results |
| `trace` | Very verbose — only during development | Function entry/exit, individual loop iterations |

### Correlation keys

Every log line inside an HTTP request context (see `requestContext.ts`) includes a `requestId`. This ID is propagated:

- **From API gateway / nginx:** via `X-Request-Id` header (if present)
- **Generated locally:** if no header is present, `crypto.randomUUID()` is used
- **To external services:** Sent as `X-Request-Id` in outbound HTTP calls
- **To downstream logs:** New Relic traces include `traceId` and `spanId` for distributed tracing

To trace a specific request end-to-end:

1. Find the `requestId` in an error log
2. Search all logs for that `requestId`
3. Cross-reference with New Relic distributed tracing using the same ID

### Log redaction

Sensitive fields are automatically redacted before they reach the log output. See `secretRedactor.ts` for the full list of redacted patterns. At minimum:

- `Authorization` headers (bearer tokens)
- Stellar private keys / seed phrases
- API keys
- JWT tokens (both request and response)

### Best practices for adding new log statements

```typescript
// ✅ Good — structured, includes correlation
logger.info({ portfolioId, tradesExecuted }, 'Rebalance completed')

// ❌ Avoid — string interpolation breaks structured search
logger.info(`Rebalance completed for ${portfolioId}`)
```

### Metrics vs logs

| Signal | Purpose | Tool |
| ------ | ------- | ---- |
| **Logs** | Detailed event records for debugging | Pino → Loki |
| **Metrics** | Aggregated counters and gauges for dashboards | Prometheus (`GET /metrics`) |
| **Traces** | Distributed request path across services | New Relic APM |

For metric definitions, see [Metrics Reference](#metrics-reference) below or the `/metrics` endpoint.

### Metrics reference

The backend exposes metrics at `GET /metrics` (when `METRICS_ENABLED=true`):

| Metric | Type | Labels | Description |
| ------ | ---- | ------ | ----------- |
| `http_requests_total` | Counter | `method`, `path`, `status` | Total HTTP requests |
| `http_request_duration_ms` | Histogram | `method`, `path` | Request duration buckets |
| `http_requests_in_flight` | Gauge | — | Currently active requests |
| `readiness_status` | Gauge | — | 1 = ready, 0 = not ready |
| `bullmq_queue_depth` | Gauge | `queue` | BullMQ queue size by name |
| `bullmq_completed_total` | Counter | `queue` | Completed BullMQ jobs |
| `bullmq_failed_total` | Counter | `queue` | Failed BullMQ jobs |
| `rebalance_executed_total` | Counter | `status` | Total rebalances executed |
| `rebalance_duration_ms` | Histogram | — | Rebalance execution duration |

### See also

- [OBSERVABILITY.md](./OBSERVABILITY.md) — Full observability stack setup
- [Logger source](../backend/src/utils/logger.ts) — Pino configuration
- [Request context source](../backend/src/utils/requestContext.ts) — AsyncLocalStorage correlation
- [Metrics source](../backend/src/middleware/metrics.ts) — Prometheus metric definitions
