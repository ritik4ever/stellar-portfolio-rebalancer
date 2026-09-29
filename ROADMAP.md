# Project Roadmap

This roadmap outlines planned features and improvements for the Stellar Portfolio Rebalancer.

*Last verified: 2026-09-29 against commit [`717ea95`](https://github.com/ritik4ever/stellar-portfolio-rebalancer/commit/717ea95).*

## ✅ Shipped

These items previously appeared here as "in progress" or "upcoming" work. They are implemented in the current codebase:

| Feature | Where it lives |
| --- | --- |
| Docker Compose profiles | `deployment/docker-compose.yml` — the default stack (`frontend`, `backend`, `reflector-mock`) plus the `full-stack` (Redis, PostgreSQL), `observability` (Prometheus, Grafana, Loki, Jaeger, Alertmanager), and `analytics` (Umami) profiles |
| Sharded backend CI tests | `.github/workflows/backend-tests.yml` — four parallel shards with merged blob coverage |
| Health smoke tests | `scripts/health-smoke.sh`, run with `npm run smoke`, against local, staging, or production |
| Email + webhook notifications | `backend/src/services/notificationService.ts`, `notificationDelivery.ts`, `webhookDeadLetter.ts`, `backend/src/api/notifications.routes.ts` |
| Analytics dashboard | `frontend/src/pages/Analytics.tsx`, backed by `backend/src/api/analytics.routes.ts` |
| Redis-backed caching | price feeds (`backend/src/services/reflector.ts`), rebalance locks (`rebalanceLock.ts`), and idempotency storage (`idempotencyRedisStore.ts`) |

## 🔜 Next — Upcoming

- **Soroban contract v2** — multi-hop swaps and limit orders. The contract already ships DCA, stop-loss, templates, fees, and circuit breakers, but multi-hop routing and limit orders are not implemented yet.

## 📅 Later — Future Considerations

- **Mobile app** — React Native companion app
- **Multi-user support** — Team portfolios with role-based access
- **Governance** — DAO voting for protocol parameters
- **Cross-chain** — Bridge support for non-Stellar assets

## Contributing

Interested in helping with any of these items? Check [open issues](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues) or open a new one to discuss.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for completed releases.

## Keeping this file accurate

Nothing fails a build when this file goes stale, so it is re-verified against the codebase at each release. When a change completes or invalidates an item above, update this file and the **Last verified** line at the top.
