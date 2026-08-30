# Notification Preferences

Users have **global** notification preferences, and may layer a **per-portfolio
override** on top of them (#1395).

## Layering model

An override stores only the fields the user actually set for that portfolio.
Everything else resolves from the global preferences, which means a later change
to a global setting still reaches portfolios that never overrode that field.

Event flags merge key-by-key: overriding `rebalance` alone leaves the other three
events resolving globally.

```
resolved = global  ⟵ override fields, where present
```

A channel enabled by an override with no destination in either layer resolves to
**off** — a half-configured override must not silently swallow notifications. The
API rejects that combination up front with 422.

`notificationService.notify()` resolves through this layer whenever the payload
carries a `portfolioId`; without one it uses the global preferences unchanged.

## Endpoints

All require JWT auth and portfolio ownership.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/preferences/notifications/portfolio` | List the caller's overrides |
| `GET` | `/api/v1/preferences/notifications/portfolio/:portfolioId` | Override + resolved preferences |
| `PUT` | `/api/v1/preferences/notifications/portfolio/:portfolioId` | Create or replace an override |
| `DELETE` | `/api/v1/preferences/notifications/portfolio/:portfolioId` | Remove it (falls back to global) |

`PUT` body — every field optional, at least one required:

```jsonc
{
  "emailEnabled": false,
  "webhookEnabled": true,
  "emailAddress": "portfolio-alerts@example.com",
  "webhookUrl": "https://hooks.example.com/xyz",
  "digestMode": "weekly",
  "events": { "rebalance": false }
}
```

Responses include `resolved`, the preferences that actually apply, with
`overrideApplied` telling you which layer answered.

## Storage

`notification_preference_overrides`, keyed by `(user_id, portfolio_id)`. Unset
columns are `NULL`, which is what "inherit from global" looks like on disk —
distinct from an explicit `false`.
