# API Migration Guide: `/api` → `/api/v1`

## Summary

`/api/v1` is the **canonical** API namespace. All new development should target `/api/v1/*`.

The legacy `/api/*` prefix is still accepted for backwards compatibility but is **deprecated** and will be removed on **2026-07-01**.

## Deprecation Headers

Every response from a legacy `/api/*` route includes:

| Header | Value |
|--------|-------|
| `Deprecation` | `true` |
| `Sunset` | `Wed, 01 Jul 2026 00:00:00 GMT` |
| `Link` | `</docs/api-migration-v1.md>; rel="deprecation"` |

## Migration

Replace the `/api` prefix with `/api/v1` in all client requests:

```
# Before (deprecated)
GET /api/portfolio/:id
POST /api/portfolio
GET /api/prices

# After (canonical)
GET /api/v1/portfolio/:id
POST /api/v1/portfolio
GET /api/v1/prices
```

Auth routes remain at `/api/auth` (no version prefix):

```
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
```

## Frontend

The frontend defaults to `/api/v1` via `frontend/src/config/apiVersion.ts`.
Set `VITE_USE_LEGACY_API=true` only as a temporary emergency override.
