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

## Error envelope

Every failing request is serialized by the single helper
`fail()` (`backend/src/utils/apiResponse.ts`) into the same envelope:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "NOT_FOUND",
    "message": "Asset not found",
    "details": { "field": "amount" }
  },
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

`error.code` is stable for a given failure class: a malformed or unknown asset
id always yields `NOT_FOUND`, a blank required parameter yields
`VALIDATION_ERROR`, and an unexpected failure yields `INTERNAL_ERROR`.

## Error serialization rules

The envelope is the only part of a failure a client can see, so it never
carries internal information:

| Rule | Behaviour |
|------|-----------|
| Credential values | Redacted in place and replaced with `[REDACTED]`. Only the value is replaced — the wording of the message is preserved, so operator hints (for example `ALLOW_FALLBACK_PRICES is disabled`) still reach the caller. |
| Stack traces | Removed. A message never contains stack frames or internal file paths. |
| `details` on 5xx | Omitted entirely. Server errors expose their `code` and a sanitized `message` only. |
| `details` on 4xx | Kept and sanitized: strings are redacted, `Error` instances are reduced to `{ name, message }`, and fields whose name denotes a secret (`apiKey`, `smtp_pass`, …) are masked. |
| `data` | Always `null` on a failure. |
| Correlation | `X-Request-Id`, `X-Correlation-Id` and `X-Trace-Id` headers are set when the corresponding values are available. |

Redaction is implemented in `backend/src/utils/errorSanitizer.ts`
(`sanitizeErrorMessage`, `sanitizeErrorDetails`) and applies to every error
that goes through `fail()`, so it covers route level failures as well as
failures handled by the global error handler
(`backend/src/middleware/apiErrorHandler.ts`).

## Coverage

`backend/src/test/apiErrorSerialization.test.ts` pins the behaviour described
above for malformed asset ids, unknown portfolio ids and upstream exceptions
carrying credentials, using isolated database/RPC doubles. The unit level
boundaries of `fail()` are covered by `backend/src/test/apiResponse.test.ts`.
