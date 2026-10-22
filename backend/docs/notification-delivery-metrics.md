# Notification Delivery Metrics

Delivery success and failure are tracked **per channel** (#1394), so an outage in
one provider is visible instead of being averaged away by the healthy ones. The
counters are registered on the existing Prometheus registry and appear on the
normal metrics endpoint — no separate scrape target.

## Metrics

| Metric | Type | Labels |
| --- | --- | --- |
| `stellar_portfolio_notification_delivery_total` | counter | `channel`, `outcome`, `reason`, `event_type` |
| `stellar_portfolio_notification_delivery_attempts_total` | counter | `channel`, `outcome` |
| `stellar_portfolio_notification_delivery_duration_seconds` | histogram | `channel`, `outcome` |

- `channel`: `email`, `webhook`, `slack`, `sms`, `telegram`
- `outcome`: `success` / `failure` on the totals; the attempts counter also uses
  `retried`, and `delayed` / `blocked` for outcomes that are not yet terminal
- `reason`: `none` on success, otherwise a classified failure bucket
- `event_type`: the rebalance event kind (for example `rebalance_completed`), so a
single event type can be correlated with a delivery outcome without logging the
recipient or payload

**Totals count terminal outcomes** (after retries are exhausted); **attempts count
individual tries**, so a delivery that succeeds on its third try records one
success in the totals and two `retried` attempts.

## Outcomes

Operators must be able to separate completed work from work that is still in
flight and work that will never complete without intervention. The `outcome`
dimension on `stellar_portfolio_notification_delivery_total` carries that
distinction:

| outcome | Meaning | Typical signal |
| --- | --- | --- |
| `success` | Provider accepted the message and the delivery is complete | Provider 20x/250 acknowledgement within the request |
| `delayed` | Provider accepted the message but the delivery confirmation has not arrived yet | Provider accepted the request, but the confirmation callback/webhook is overdue or the provider reported a queued state |
| `blocked` | Delivery cannot progress without operator action | Configuration is missing/invalid, the recipient is rejected, or auth is refused in a way retries cannot fix |
| `failure` | Terminal failure after retries are exhausted | Exhausted backoff or a non-retryable error that is not operator-actionable |

A provider that accepts a message and then times out waiting for the delivery
confirmation is recorded as `delayed` with `reason="timeout"` and the same
`event_type` as the original send. The acceptance is not counted as a success
until the confirmation arrives, so the delayed counter is the signal to investigate
rather than a success that masks a stuck delivery.

## Failure reasons

The `reason` label is a bounded classification, never the raw error string — raw
messages contain ids and timestamps and would explode label cardinality.

| reason | Triggered by |
| --- | --- |
| `auth` | 401/403, or an auth-shaped SMTP error |
| `rate_limited` | HTTP 429 |
| `timeout` | HTTP 408, `ETIMEDOUT`, or a timeout message |
| `server_error` | HTTP 5xx |
| `client_error` | Other HTTP 4xx |
| `connection_refused` | `CONNECTREFUSED`, `CONNECRESET`, `EPIPE` |
| `dns` | `ENOTFOUND`, `EAI_AGAIN` |
| `not_configured` | Provider missing configuration |
| `invalid_recipient` | Rejected destination address |
| `unknown` | Anything unclassified |

## Instrumentation points

For duplicate rebalance events, delivery identity and interpretation of `skipped`
attempt records are specified in [Email notification service boundary](email-notification-boundary.md).

`deliverWithBackoff` in `services/notificationDelivery.ts` instruments every
channel that goes through the retry wrapper (email and webhook today) — success,
each retry, and the terminal failure.

Channels that do not use the wrapper (a fire-and-forget send, or a provider with
its own retry handling) report through `recordChannelDelivery`, so every channel
lands in the same counters:

```ts
recordChannelDelivery({ channel: 'slack', success: false, error, eventType })
```

For asynchronous providers that confirm delivery out of band, the acceptance response
records `delayed` and the confirmation callback updates the outcome to `success` on
the same `event_type` and `channel`. If the confirmation does not arrive within the
configured window, the outcome stays `delayed` with `reason="timeout"` and the
operator alert fires.

## Useful queries

```promql
# Failure rate per channel over 5m
sum by (channel) (rate(stellar_portfolio_notification_delivery_total{outcome="failure"}[5m]))
  / sum by (channel) (rate(stellar_portfolio_notification_delivery_total[5m]))

# Which failure mode dominates
topk(5, sum by (channel, reason) (rate(stellar_portfolio_notification_delivery_total{outcome="failure"}[15m])))

# Retry pressure
sum by (channel) (rate(stellar_portfolio_notification_delivery_attempts_total{outcome="retried"}[5m]))

# Deliveries stuck waiting for a provider confirmation
sum by (channel, event_type) (rate(stellar_portfolio_notification_delivery_total{outcome="delayed"}[5m]))

# Work that needs an operator to unblock it
sum by (channel, reason) (rate(stellar_portfolio_notification_delivery_total{outcome="blocked"}[15m])))
```
