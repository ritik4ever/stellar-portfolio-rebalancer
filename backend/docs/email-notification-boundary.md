# Email notification service boundary

`NotificationService.notify(payload)` accepts rebalance notifications. Two events
representing the same logical notification must carry the same delivery identity.
The email provider resolves it in this order (existing precedence is preserved):

1. `payload.deliveryId`
2. `payload.data.deliveryId`
3. `rebalance-job-${payload.data.jobId}`
4. `rebalance-${payload.data.rebalanceId}`

Producers should use a non-empty string ID unique to a logical notification for that
user and event type. Separate notifications (for example an intentional
failure alert and a later completion alert) need separate IDs. Changing the title
or reconstruction timestamp does not change the SMTP Message-ID when the delivery
identity is unchanged. The Message-ID and duplicate tracking both identify the
notification by user, event type and delivery ID{; the configured sender supplies
the Message-ID domain.

## Two events for one rebalance

For example, submit two `rebalance` payloads for `user-1`, each with
`data: { jobId: "job-42" }`, even if their timestamps differ. Both resolve to
`rebalance-job-job-42`:

| First delivery | Second event | SMTP effect and trace |
| --- | --- | --- |
| In progress | Concurrent duplicate | Waits for the first delivery; logs `skipped`, with no second send |
| Sent | Later replay | Logs `skipped`; the original `sent` record remains the delivery result |
| Temporary refusal | Duplicate after recovery | Retries within policy, records `retried` then `sent`; replay logs `skipped` |
| Uncertain (e.g. timeout) | Later replay | Logs `skipped`; retains `uncertain`, with no automatic resend |
| Definite failure | Later retry event | May attempt again, reusing the same SMTP Message-ID |

Attempt records carry the resolved `deliveryId`, attempt number and retry budget.
Inspect email records from `getDeliveryLogs(userId, limit, deliveryId)` to correlate
the events. A duplicate's `skipped` record is an audit decision, not a new SMTP
result; the original `sent`, `failed`, or `uncertain` record remains in the trace.
`notify` retains its best-effort `Promise<void>` contract: it logs provider errors
and does not return an SMTP success acknowledgement. `getDeliveryStatus` reports
the latest log entry, which can therefore be `skipped` after a duplicate.

## Success, delay, and blocked work

Every terminal delivery record carries a `deliveryState` field so operators can
tell the three outcomes apart without parsing the error string:

- `success` — the provider confirmed acceptance.
- `delayed` — the provider proved it did not act, but the retry budget is
  exhausted (or the delivery was aborted). The work is still pending and a replay is
  safe.
- `blocked` — the outcome is unknown (ambiguous) or the provider rejected the
  message permanently. Automatic replay would risk a duplicate or just fail again.

The adjacent `deliveryState` and `failureKind` fields on a log row agree: a
 `retryable` failure is `delayed`, while `ambiguous` and `permanent` failures are
`blocked`. The metric counters use the same vocabulary (see
Notification delivery metrics](notification-delivery-metrics.md)).

## Limits and compatibility

Duplicate tracking is currently in memory in one process. It does not guarantee
exactly-once delivery across restarts or multiple workers. SMTP Message-ID is a
correlation identifier, not a guarantee that the mail server deduplicates mail.
Without a delivery ID or one of the supported fallback IDs, existing behavior is
preserved: no duplicate suppression, and Message-ID derives from user, portfolio,
event type, timestamp and title. Callers must supply an identity for the two-event
contract. Other notification channels, raw emails, HTTP schemas and retry policy
are unchanged.

Regression coverage: `npm test -- src/test/emailNotificationBoundary.test.ts`
from `backend/`. It exercises the real service and retry wrapper with mocked SMTP
and log persistence; database persistence is covered separately by
`emailNotificationStateConsistency.test.ts`.
