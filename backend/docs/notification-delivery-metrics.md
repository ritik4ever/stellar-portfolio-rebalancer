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
  `retried`
- `reason`: `none` on success, otherwise a classified failure bucket

**Totals count terminal outcomes** (after retries are exhausted); **attempts count
individual tries**, so a delivery that succeeds on its third try records one
success in the totals and two `retried` attempts.

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
| `connection_refused` | `ECONNREFUSED`, `ECONNRESET`, `EPIPE` |
| `dns` | `ENOTFOUND`, `EAI_AGAIN` |
| `not_configured` | Provider missing configuration |
| `invalid_recipient` | Rejected destination address |
| `unknown` | Anything unclassified |

## Instrumentation points

`deliverWithBackoff` in `services/notificationDelivery.ts` instruments every
channel that goes through the retry wrapper (email and webhook today) — success,
each retry, and the terminal failure.

Channels that do not use the wrapper (a fire-and-forget send, or a provider with
its own retry handling) report through `recordChannelDelivery`, so every channel
lands in the same counters:

```ts
recordChannelDelivery({ channel: 'slack', success: false, error, eventType })
```

## Useful queries

```promql
# Failure rate per channel over 5m
sum by (channel) (rate(stellar_portfolio_notification_delivery_total{outcome="failure"}[5m]))
  / sum by (channel) (rate(stellar_portfolio_notification_delivery_total[5m]))

# Which failure mode dominates
topk(5, sum by (channel, reason) (rate(stellar_portfolio_notification_delivery_total{outcome="failure"}[15m])))

# Retry pressure
sum by (channel) (rate(stellar_portfolio_notification_delivery_attempts_total{outcome="retried"}[5m]))
```
