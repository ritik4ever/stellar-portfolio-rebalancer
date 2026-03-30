# API v1 Migration

`/api/v1/*` is the canonical API namespace.

Legacy `/api/*` routes are supported only as a compatibility alias and include deprecation metadata headers:

- `Deprecation: true`
- `Sunset: Wed, 01 Jul 2026 00:00:00 GMT`
- `Link: </docs/api-migration-v1.md>; rel="deprecation"`

## Canonical endpoints

- Portfolio + market data routes: `/api/v1/*`
- Authentication routes: `/api/auth/*` (JWT challenge/login/refresh remain outside the versioned prefix; see root `API.md`)

## Legacy alias behavior

Calls to `/api/*` are routed to the same v1 handlers while responses include deprecation headers so clients can migrate without ambiguity.
