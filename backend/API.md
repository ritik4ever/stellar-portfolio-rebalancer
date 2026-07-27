# API Reference

## Versioning

All API endpoints are served under the `/api/v1/` prefix.

### Current version: v1

All new clients should use `/api/v1/*` endpoints exclusively.

### Deprecated: unversioned `/api/*`

Legacy endpoints under `/api/*` (without the `/v1/` segment) are deprecated and will be removed on the sunset date below.

Requests to deprecated paths return the following RFC 8594 compliant headers:

| Header | Value |
|---|---|
| `Deprecation` | `true` |
| `Sunset` | `Wed, 01 Jul 2026 00:00:00 GMT` |
| `Link` | `</docs/api-migration-v1.md>; rel="deprecation"` |
| `X-API-Warn` | `deprecated; sunset="Wed, 01 Jul 2026 00:00:00 GMT"; docs="/docs/api-migration-v1.md"` |
| `X-API-Suggest` | `Use /api/v1/<path> instead` |

### Migration timeline

| Date | Milestone |
|---|---|
| 2026-03-01 | v1 endpoints available; deprecation headers added to legacy paths |
| 2026-06-24 | Final deprecation warning period (7 days before sunset) |
| **2026-07-01** | **Sunset** — legacy `/api/*` paths stop responding |

### Authentication endpoints

Auth routes (`/api/auth/*`) are not versioned and remain outside the `/api/v1/` prefix.

- `POST /api/auth/challenge`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/logout-all`

### How to migrate

Replace `/api/` with `/api/v1/` in all endpoint URLs. No request or response schema changes are required.

See [docs/api-migration-v1.md](docs/api-migration-v1.md) for full details.
