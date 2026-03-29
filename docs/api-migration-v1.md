# API Migration Guide: `/api` → `/api/v1`

This document describes the migration from the legacy unversioned `/api/*` namespace to the canonical `/api/v1/*` namespace.

## Timeline

| Date | Milestone |
|------|-----------|
| 2026-03-01 | `/api/v1/*` namespace introduced; both namespaces served identical responses |
| 2026-04-01 | Legacy `/api/*` paths return `Deprecation`, `Sunset`, and `Link` headers |
| 2026-07-01 | **Sunset date** — legacy `/api/*` paths will return `410 Gone` |

## What is changing?

All API endpoints are moving from:

```
/api/{resource}
```

to:

```
/api/v1/{resource}
```

The only exception is `/api/auth/*`, which remains unversioned.

## Deprecation headers

Clients hitting legacy `/api/*` paths will receive these HTTP headers:

| Header | Value | Meaning |
|--------|-------|---------|
| `Deprecation` | `true` | RFC 8594: this resource is deprecated |
| `Sunset` | `Wed, 01 Jul 2026 00:00:00 GMT` | After this date, the resource may no longer be available |
| `Link` | `<docs/api-migration-v1.md>; rel="deprecation"` | Points to this migration document |

## How to migrate

### Step 1: Update base URL

Change your API client's base URL from:

```
https://your-api.example.com/api/
```

to:

```
https://your-api.example.com/api/v1/
```

### Step 2: Verify no deprecation headers

After migrating, responses should **not** include `Deprecation`, `Sunset`, or `Link` headers. If you see these headers, you are still hitting the legacy path.

### Step 3: Test your integration

Run your existing test suite against the `/api/v1/*` namespace. All endpoints maintain backward compatibility in their request/response formats.

## What stays the same

- Request and response formats are identical between `/api/*` and `/api/v1/*`
- Authentication mechanisms are unchanged
- Idempotency key behavior is unchanged
- Rate limits are shared between namespaces

## What happens after sunset (2026-07-01)?

After the sunset date, legacy `/api/*` paths will return:

```json
{
  "success": false,
  "error": {
    "code": "GONE",
    "message": "This API version has been sunset. Use /api/v1/ instead. See docs/api-migration-v1.md"
  }
}
```

## Questions?

Open an issue on the repository or contact the maintainers.
