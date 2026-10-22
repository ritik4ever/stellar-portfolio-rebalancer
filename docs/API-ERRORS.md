# API Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| NOT_FOUND | 404 | Resource not found |
| VALIDATION_ERROR | 400 | Invalid request body |
| UNAUTHORIZED | 401 | Missing or invalid token |
| RATE_LIMITED | 429 | Too many requests |
| CONFLICT | 409 | Resource conflict (e.g. concurrent rebalance in progress) |
| INTERNAL_ERROR | 500 | Unexpected server error |

## Portfolio Rebalancing Error Serialization (SPR-2026-189)

During portfolio rebalancing workflows, API error responses and persisted event history distinguish operational states and diagnose upstream issues without secret exposure:

### Signals
- **Success (`200 OK`)**: Rebalance evaluated and executed or settled normally (`status: 'completed'` or clean dry-run preview).
- **Delay (`409 CONFLICT` / `429 RATE_LIMITED`)**: Rebalance cannot proceed immediately due to an active lock (`CONFLICT`, `Rebalance already in progress for this portfolio`) or rate limits; callers should retry with backoff.
- **Blocked Work (`400 BAD_REQUEST` / `403 FORBIDDEN` / `404 NOT_FOUND` / `500 INTERNAL_ERROR`)**:
  - `BAD_REQUEST`: Blocked by policy or risk guardrails (e.g., circuit breaker active, slippage limits, or risk models).
  - `FORBIDDEN` / `NOT_FOUND`: Unauthorized access or missing portfolio resources.
  - `INTERNAL_ERROR`: Upstream network, RPC, or database failure.

### Credential Protection & Diagnostic Context
- Upstream exceptions carrying internal credentials (e.g., database connection strings with passwords, Stellar secret keys `S...`, or API tokens) are strictly redacted with `[REDACTED]`.
- Persisted failure events record `source: 'api'`, `outcome: 'failed'`, and sanitized `diagnosticContext` in rebalance history details, enabling operators to diagnose upstream failures without exposing secret values to external callers or audit trails.

