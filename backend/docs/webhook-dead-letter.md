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

Both paths share `postDeadLetterPayload()` in `services/webhookDeadLetter.ts`, so
there is one definition of what a replay request is.
