# Webhook Delivery Retry Edge Cases

Deterministic test coverage added in **SPR-2026-175** for two edge cases that
are orthogonal to the happy path but critical for operator confidence.

## 1. 429 Retry-After

When a webhook callback responds with **HTTP 429 Too Many Requests** the
delivery layer honours the `Retry-After` header rather than applying its own
exponential backoff.

### Behaviour

| Scenario | Outcome |
| --- | --- |
| 429 + numeric `Retry-After: 30` | `retryAfterMs = 30_000`, `nextAttemptAt = now + 30_000` |
| 429 + HTTP-date `Retry-After` | Delta parsed from the date; `nextAttemptAt` set accordingly |
| 429 + no `Retry-After` header | Default backoff of `DEFAULT_RETRY_AFTER_MS` (60 s) applied |
| `Retry-After` > `MAX_RETRY_AFTER_MS` (86 400 s) | Clamped to `MAX_RETRY_AFTER_MS` |
| 5xx (e.g. 503) | Treated as retryable with the same default backoff as 429 |
| Non-retryable 4xx (e.g. 400) | Routed to dead-letter; `retryable: false`, no retry fields |

### Identity fields

Every call to `fireWebhook` — including retried calls for the same event —
produces the same `deliveryId` and `deduplicationKey` as long as the payload
and timestamp are identical. This allows the receiver to deduplicate retried
deliveries idempotently.

```
deliveryId       = SHA-256(hmac_signature + ":" + timestamp)   (64 hex chars)
deduplicationKey = deliveryId
```

These fields are present in the result for every outcome (delivered, retry,
dead-letter), giving callers a single stable handle for observability and
idempotency checks.

### Source: `backend/src/notifications/webhook.ts`

Key functions: `fireWebhook`, `parseRetryAfter`, `isRetryableStatus`.

Test file: `backend/src/test/webhookRetry429.test.ts` (8 tests).

---

## 2. Worker restart before recording success

`deliverWithBackoff` in `services/notificationDelivery.ts` tracks in-flight
deliveries in a module-level `inFlightDeliveries` map and records completed
deliveries in a `completedDeliveries` map. A worker restart (modelled as an
`AbortSignal` abort) can interrupt a delivery before the terminal outcome is
persisted.

### Behaviour after an abort

| State | Effect |
| --- | --- |
| Abort fires during a backoff sleep | `finally` block logs `"Delivery aborted before completion"` with `deliveryState: "deliayed"` (source typo preserved) |
| `inFlightDeliveries` map | Cleaned up in the `finally` block; the promise is removed |
| `completedDeliveries` map | **No entry is written** — neither `sent` nor `uncertain` |
| Next call with the same `deliveryId` | **Not deduplicated** — treated as a fresh delivery |

### Deduplication after restart

Because no `sent` entry is recorded for the aborted run, a subsequent call
using the same `deliveryId` is processed normally. Once that call succeeds, a
`sent` entry is written and all further calls with that `deliveryId` are
deduplicated (logged as `skipped` with `deliveryState: "success"`).

### In-flight deduplication (no restart)

When two concurrent calls share the same `deliveryId` and the first is still
in flight, the second awaits the first's promise and logs a `skipped` outcome.
`execute` is called exactly once; no duplicate side effects occur.

### Abort before the first attempt

If the signal is already aborted when `deliverWithBackoff` is entered, the
function rejects immediately without calling `execute`.

### Source: `backend/src/services/notificationDelivery.ts`

Key functions: `deliverWithBackoff`, `_resetDeliveriesForTest` (test isolation only).

Test file: `backend/src/test/webhookWorkerRestart.test.ts` (6 tests).

---

## Known source issues pinned by these tests

| File | Issue | Test impact |
| --- | --- | --- |
| `notifications/webhook.ts` | `import crypto from 'cypto'` — typo for `'crypto'` | Test mocks `'cypto'` to redirect to `node:crypto` |
| `services/notificationDelivery.ts` | `deliveryState: "deliayed"` in the abort finally block — typo for `"delayed"` | `ABORT_DELIVERY_STATE` constant in the test pins the exact value so a future fix surfaces as a test failure |
