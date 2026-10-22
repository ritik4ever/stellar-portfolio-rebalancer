# Webhook Delivery Retry Outcomes

SPR-2026-174 makes every webhook delivery attempt produce one of three
operator-actionable states — **success**, **delayed** or **blocked** — with
enough context to diagnose an interrupted worker, without logging the
capability token embedded in the webhook URL.

Before this change an operator could see that a webhook failed, but not tell a
receiver that asked us to back off (`429`) from a payload it will never accept
(`400`), from a delivery that was interrupted mid-flight by a worker restart.
The fabricated `statusCode: 429` for network failures made the first and last
cases indistinguishable in logs.

## States

| State | Meaning | Operator response |
| --- | --- | --- |
| `success` | The receiver acknowledged the delivery with a 2xx. | None. |
| `delayed` | The attempt failed in a way that proves the receiver did not accept the payload, and another attempt is still scheduled. | Wait for the retry; investigate only if the delay repeats. |
| `blocked` | The retry budget is exhausted, the receiver rejected the payload permanently (non-408/429 4xx), or the destination is misconfigured. | Fix the receiver/config, then replay from the dead-letter queue. |

`delayed` and `blocked` are not synonyms for "failed": a retryable failure with
no retry left is **blocked** work. That distinction is what tells on-call
whether the system can heal itself or a human must act.

## Signals

### Structured log records

`services/webhookDeliveryOutcome.ts` emits two records per attempt:

| Record | Level | When |
| --- | --- | --- |
| `Webhook delivery attempt started` | info | **Before** the HTTP request is made |
| `Webhook delivery succeeded` / `Webhook delivery delayed; retry scheduled` / `Webhook delivery blocked; operator action required` | info / warn / error | After the outcome is known |

Both carry the same correlation context:

| Field | Example | Purpose |
| --- | --- | --- |
| `source` | `https://hooks.example.com/[redacted:7fe46797]` | Which provider/destination failed, without the path token |
| `provider` | `webhook` | Channel vocabulary shared with the other notifiers |
| `eventType` | `rebalance` | Ties the outcome to the portfolio event |
| `deliveryId` | `03d885b2…46dc` | Stable identity across attempts and restarts |
| `userId` | `G…` | Who the notification belongs to |
| `attempt` / `maxAttempts` | `2` / `5` | Where in the retry budget the attempt sits |
| `deliveryState` | `success` / `delayed` / `blocked` | The operator-facing state |
| `outcome` | `rate_limited` | Bounded reason code |
| `retryable` | `true` | Whether the layer will try again |
| `mayHaveDelivered` | `true` | The receiver may already have processed the payload |
| `statusCode` | `429` | Real HTTP status only — absent for transport failures |
| `retryAfterMs` / `nextAttemptAt` | `30000` / ISO-8601 | The scheduled retry |
| `detail` | `Request failed with status code 429` | Sanitised diagnostic text |

The start record is written before the request precisely so that a worker dying
between "receiver accepted" and "success recorded" leaves evidence.

### Diagnosing a worker restart

1. Find the `deliveryId` you care about (from the dead-letter entry, the
   notification log row's `delivery_id`, or an error report).
2. Look for `Webhook delivery attempt started` with that id.
3. If there is **no terminal record** for the same `deliveryId` **and**
   `attempt`, the worker died mid-delivery. The outcome is unknown: the receiver
   may already have processed the payload.
4. Because unknown outcomes are deliberately not recorded as `sent`, the next
   delivery for the same event is attempted again rather than deduplicated. If
   the payload reached the receiver, deduplicate on `X-Delivery-Id`
   (`fireWebhook`) or the notification `deliveryId` before applying side
   effects.
5. Check the dead-letter queue (`GET /api/v1/admin/notifications/dead-letter`)
   for blocked work; replay once the receiver is healthy.

Aborted deliveries (worker shutdown before a terminal outcome) are recorded as
`deliveryState: "delayed"` with `Delivery aborted before completion`, so they
are distinguishable from real rejections and are safe to replay.

### Metric

```text
stellar_portfolio_webhook_delivery_outcome_total{outcome, reason, event_type}
```

- `outcome`: `success` / `delayed` / `blocked`
- `reason`: bounded classification (`provider_accepted`, `rate_limited`,
  `server_error`, `client_error`, `auth`, `timeout`, `connection_refused`,
  `dns`, or `<reason>_retries_exhausted`)
- `event_type`: the portfolio event kind

The destination is deliberately **not** a label: it contains a capability token
and would make cardinality unbounded.

Useful queries:

```promql
# Blocked webhook work that needs an operator
sum by (reason, event_type) (
  rate(stellar_portfolio_webhook_delivery_outcome_total{outcome="blocked"}[15m])
)

# Deliveries still waiting on a retry
sum by (event_type) (
  rate(stellar_portfolio_webhook_delivery_outcome_total{outcome="delayed"}[5m])
)

# Success ratio per event type
sum by (event_type) (rate(stellar_portfolio_webhook_delivery_outcome_total{outcome="success"}[5m]))
/
sum by (event_type) (rate(stellar_portfolio_webhook_delivery_outcome_total[5m]))
```

### Dead-letter queue

`WebhookProvider` keeps its existing behaviour: a delivery that exhausts its
retries is pushed to the dead-letter queue with the original payload and the
number of attempts consumed. The terminal log record marks it `blocked`, so the
queue and the metric agree on what needs an operator.

## Redaction guarantees

Webhook URLs usually carry a capability token in the path (for example
`https://hooks.slack.com/services/T000/B000/XXXX`). Logging the URL would hand
anyone with log access the ability to post to the receiver.

- `redactWebhookEndpoint` keeps scheme/host/port and replaces the path, query
  and fragment with a stable 8-character digest. The digest still lets two
  attempts to the same destination be correlated.
- `sanitizeWebhookDetail` removes `Bearer`/`Basic` credentials, secret-looking
  query parameters, embedded URLs and long hex strings (signatures), then caps
  the text at 200 characters.
- `fireWebhook` no longer passes the raw Axios error to `console.error`; the
  Axios error object contains the request config, including the signature
  header, and must never be logged verbatim.

## Tests

`src/test/webhookDeliveryOutcome.test.ts` covers classification for 2xx, 429,
5xx, permanent 4xx, auth failures, timeouts, refused connections and exhausted
retry budgets; endpoint/detail redaction; log and metric shape; and
`fireWebhook` integration including the "no fabricated 429" regression.

`src/test/webhookRetry429.test.ts` continues to cover `Retry-After` parsing, and
`src/test/webhookWorkerRestart.test.ts` covers the abort/restart path.
