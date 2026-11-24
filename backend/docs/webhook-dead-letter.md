# Webhook Dead-Letter Queue

Webhook deliveries that exhaust their retries land in the dead-letter queue.
Admins can browse and replay them without touching the database (#1393).

## Endpoints

All admin-authenticated.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/admin/notifications/dead-letter` | Browse entries (filter + paginate) |
| `POST` | `/api/v1/admin/notifications/dead-letter/:id/replay` | Replay one entry |
| `POST` | `/api/v1/admin/notifications/dead-letter/batch-replay` | Replay `{ ids }` or `{ replayAll: true }` |
| `DELETE` | `/api/v1/admin/notifications/dead-letter/:id` | Discard one entry |

### Listing query parameters

| Param | Default | Notes |
| --- | --- | --- |
| `userId` | — | Exact match |
| `eventType` | — | Exact match |
| `search` | — | Substring over id, user, url and error message |
| `page` | `1` | Clamped to the available page count |
| `pageSize` | `50` | 1–500 |

The response carries `items`, a `summary` (total, counts per event type, oldest
and newest timestamps) and `pagination`. Every entry keeps its **failure reason**
(`errorMessage`), its **original payload**, and how many attempts were exhausted.

## Replay semantics

A replay removes the entry from the queue, then POSTs the original payload back
to its webhook URL with an `X-Webhook-Replay: true` header.

- **Success** → the entry stays removed.
- **Failure** → it is re-queued with `attemptsExhausted` incremented, so repeated
  failures are visible and nothing is lost.

Batch replay applies the same rule per entry and reports
`{ total, succeeded, failed, failedIds }`.

Both paths share `postDeadLetterPayload()` in `services/webhookDeadLetter.ts`, so there is one definition of what a replay request is.

## Retry boundary handling

When a replay is attempted while the target is still within its retry window, the
service boundary rejects the replay with HTTP **429 Too Many Requests** and a
`Retry-After` header in seconds. This is the canonical boundary contract for
webhook delivery retry.

Every 429 response is stable and deterministic for the same inputs:

| Field | Location | Meaning |
| --- | --- | --- |
| `deliveryId` | body | Identifies the delivery being deferred |
| `nextAttemptAt` | body | ISO-8601 timestamp of the next attempt |
| `deduplicated` | body | `true` when the request matched an already-scheduled attempt |
| `Retry-After` | header | Seconds until the next attempt is allowed |

Example response:

```json
{
  "deliveryId": "dl_123",
  "nextAttemptAt": "2026-01-01T00:00:30Z",
  "deduplicated": false
}
```

Repeated requests for the same delivery within the retry window return the same
`deliveryId` and `nextAttemptAt`, with `deduplicated: true`, so clients can retry
safely without creating duplicate deliveries.
