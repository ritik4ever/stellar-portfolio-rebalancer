# Stellar Portfolio Rebalancer — API

This document describes the HTTP API for the Stellar Portfolio Rebalancer backend. For full request/response schemas and try-it-now usage, use the **OpenAPI 3.0** spec and **Swagger UI**.

## Quick links

| Resource | URL / action |
|----------|----------------|
| **Swagger UI** (interactive docs) | [http://localhost:3001/api-docs](http://localhost:3001/api-docs) (when the backend is running on the default port) |
| **OpenAPI 3.0 spec (JSON)** | [http://localhost:3001/api-docs.json](http://localhost:3001/api-docs.json) or `/api-docs/openapi.json` (same document) — use for **Postman** (Import → Link) or other tools |
| **Postman collection** | Import the OpenAPI spec: see [Postman collection](#postman-collection) below |

## Base URL

- **Development:** `http://localhost:3001` (or the port set by `PORT` on the backend)
- **Production:** Your deployed backend URL

All API routes below are relative to the base URL.

### URL versioning

| Namespace | Purpose |
|-----------|---------|
| **`/api/v1/*`** | **Canonical** portfolio/API surface. Prefer this for new clients; responses do not include deprecation headers. |
| **`/api/*`** (same paths, no `v1` segment) | **Legacy** compatibility; the server may attach `Deprecation`, `Sunset`, and `Link` headers (RFC 8594). |
| **`/api/auth/*`** | JWT login, refresh, and logout — **not** under `/api/v1` (see `backend/src/http/mountApiRoutes.ts`). |

The **frontend** defaults to `/api/v1` for resource routes via `VITE_API_VERSION` and `API_RESOURCE_ROOT` in `frontend/src/config/api.ts` (see `frontend/.env.example`). Set `VITE_USE_LEGACY_API=true` only for emergency rollback to unversioned `/api/*`.

## Authentication

- Most endpoints are unauthenticated.
- **Admin-only** endpoints (e.g. auto-rebalancer start/stop, sync-onchain, auto-rebalancer history) require admin auth (e.g. `Authorization` header or project-specific mechanism). See the OpenAPI spec and your deployment config for details.

## Response format

Success responses use a common envelope:

```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "meta": { ... }
}
```

Error responses:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable message",
    "details": { ... }
  },
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

## Idempotency

Select write endpoints support the `Idempotency-Key` request header. When provided, the server stores the response of the first successful call and returns the same response for any subsequent request that carries the same key, preventing duplicate side effects from client retries.

### How it works

1. Include an `Idempotency-Key` header (1–255 characters, e.g. a UUID) on any supported `POST` or `PATCH` request.
2. On the **first** call the server processes the request normally and caches the response (TTL: 24 hours).
3. On any **repeat** call with the same key _and identical body_, the server returns the cached response with an `Idempotency-Replayed: true` header — no side effects are triggered again.
4. If the same key is reused with a **different body**, the server returns `409 CONFLICT`.

### Conflict handling

| Scenario | HTTP Status | Error code |
|----------|-------------|------------|
| Same key, same body (retry) | Cached status | — (`Idempotency-Replayed: true`) |
| Same key, different body | `409` | `CONFLICT` |
| Key is empty or > 255 chars | `400` | `VALIDATION_ERROR` |

### Supported endpoints

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api/consent` | Consent recording — replay is safe; double-submit has no additional effect |
| `POST` | `/api/portfolio` | Portfolio creation — prevents duplicate portfolios on retry |
| `POST` | `/api/portfolio/:id/rebalance` | Rebalance execution — prevents double-execution on retry |
| `POST` | `/api/rebalance/history` | Rebalance event recording — prevents duplicate history entries |
| `POST` | `/api/notifications/subscribe` | Notification subscription — idempotent preference upsert |
| `POST` | `/api/admin/assets` | Asset registry — prevents duplicate asset creation on retry |
| `PATCH` | `/api/admin/assets/:symbol` | Asset enable/disable — safe to replay the same state change |

### Example

```http
POST /api/consent
Content-Type: application/json
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000

{
  "userId": "GABC...",
  "terms": true,
  "privacy": true,
  "cookies": true
}
```

A retry with the same `Idempotency-Key` and body returns the cached `200` response immediately. A retry with a different body returns `409 CONFLICT`.

### Key retention and cleanup

Idempotency keys are automatically cleaned up to prevent unbounded table growth:

| Setting | Value |
|---------|-------|
| **Key TTL** | 24 hours from creation |
| **Cleanup cadence** | Every 60 minutes (via BullMQ scheduled job) |
| **Startup cleanup** | Runs once on server startup |

Expired keys (older than 24 hours) are permanently deleted during each cleanup cycle. The cleanup job logs the number of removed keys on every run for operational visibility. When Redis is unavailable, the cleanup job is not scheduled; expired keys are still filtered out at query time and will be purged once the scheduler resumes.

## Endpoints overview

### Health and info

- **GET /** — API info, version, feature flags, and endpoint list.
- **GET /health** — Health check; includes auto-rebalancer status.
- **GET /ready** — Deep readiness probe covering database, Redis/queues, workers, indexer, and auto-rebalancer startup.

### Portfolio

- **POST /api/portfolio** — Create portfolio (`userAddress`, `allocations`, `threshold`, optional `slippageTolerance`). Allocations must sum to 100%; threshold 1–50%. Supports `Idempotency-Key`.
- **GET /api/portfolio/{id}** — Get portfolio by ID.
- **GET /api/user/{address}/portfolios** — List portfolios for a Stellar address. When JWT auth is enabled, the token subject must match `:address` (otherwise `403`). In demo mode, public-by-address listing is allowed only when `ALLOW_PUBLIC_USER_PORTFOLIOS_IN_DEMO` is enabled.
- **GET /api/portfolio/{id}/rebalance-plan** — Get rebalance plan (total value, slippage, prices).
- **POST /api/portfolio/{id}/rebalance** — Execute rebalance (body optional: `{ options: { simulateOnly, ignoreSafetyChecks, slippageOverrides } }`). Supports `Idempotency-Key`.
- **GET /api/portfolio/{id}/analytics** — Analytics time series (query: `days`, default 30).
- **GET /api/portfolio/{id}/performance-summary** — Performance summary.

### Rebalance history

- **GET /api/rebalance/history** — List rebalance events (query: `portfolioId`, `limit`, `source`, `startTimestamp`, `endTimestamp`, `syncOnChain`).
- **POST /api/rebalance/history** — Record a rebalance event. Supports `Idempotency-Key`.
- **POST /api/rebalance/history/sync-onchain** — Sync on-chain rebalance history (admin).

### Risk

- **GET /api/risk/metrics/{portfolioId}** — Risk metrics and recommendations.
- **GET /api/risk/check/{portfolioId}** — Check if rebalance is allowed (risk check).

### Prices and market

- **GET /api/prices** — Current asset prices (e.g. XLM, BTC, ETH, USDC).
- **GET /api/prices/enhanced** — Prices with risk/volatility info.
- **GET /api/market/{asset}/details** — Market details for one asset.
- **GET /api/market/{asset}/chart** — Price history for charting (query: `days`, default 7).

### Auto-rebalancer

- **GET /api/auto-rebalancer/status** — Status and statistics.
- **POST /api/auto-rebalancer/start** — Start (admin).
- **POST /api/auto-rebalancer/stop** — Stop (admin).
- **POST /api/auto-rebalancer/force-check** — Force check (admin).
- **GET /api/auto-rebalancer/history** — Auto-rebalance history (admin; query: `portfolioId`, `limit`).

### System and queue

- **GET /api/system/status** — System status (portfolios, history, risk, auto-rebalancer, indexer, feature flags).
- **GET /api/queue/health** — BullMQ queue health and Redis connectivity.

### Notifications

- **POST /api/notifications/subscribe** — Subscribe (userId, email/webhook, events). Supports `Idempotency-Key`.
- **GET /api/notifications/preferences** — Get preferences (query: `userId`).
- **DELETE /api/notifications/unsubscribe** — Unsubscribe (query: `userId`).

## OpenAPI 3.0 specification

The API is described in full by an **OpenAPI 3.0** specification:

- **Served by backend:** When the backend is running, the spec is available at:
  - **JSON:** `GET /api-docs.json` (alias: `GET /api-docs/openapi.json`)
- **Swagger UI** at `/api-docs` uses this spec and provides:
  - All endpoints with descriptions
  - Request and response schemas
  - Examples and try-it-now (against the running server)

Third-party integration (e.g. code generation, API gateways, testing) can use the same OpenAPI spec.

## Postman collection

You can use the OpenAPI spec as a Postman collection source:

1. **Import from URL (recommended)**  
   - In Postman: **Import** → **Link**.  
   - Enter: `http://localhost:3001/api-docs.json`  
   - Ensure the backend is running so the URL is reachable.

2. **Import from file**  
   - Export the spec to a file (see below), then in Postman: **Import** → **Upload** and select the JSON file.

**Export spec to file (optional):**

From the backend directory:

```bash
cd backend
npm run openapi:export
```

This writes `backend/openapi.json`. In Postman: **Import** → **Upload** → select `openapi.json`.

### Maintaining Documentation Sync

The **authoritative spec** is `backend/src/openapi/spec.ts` (what Swagger and the server use). The checked-in `backend/openapi.json` is produced from it for Postman and CI diffing. See [backend/docs/openapi.md](backend/docs/openapi.md).

To ensure that `API.md`, `openapi.json`, and `spec.ts` stay aligned, run the validation script below.

**To validate sync:**
```bash
cd backend
npm run api:validate
```

**To refresh generated outputs (if you've changed the API code):**
```bash
cd backend
npm run openapi:export
```
The CI pipeline will fail if documents are out of sync.

## Examples

### Create portfolio

```http
POST /api/portfolio
Content-Type: application/json

{
  "userAddress": "GABC...",
  "allocations": { "XLM": 40, "BTC": 30, "USDC": 30 },
  "threshold": 5,
  "slippageTolerance": 1
}
```

### Get current prices

```http
GET /api/prices
```

Successful `data` is `{ prices, feedMeta }`: `prices` is a map of assets to quote fields (including optional `source`, `servedFromCache`, `quoteAgeSeconds`, `dataTier`), and `feedMeta` describes resolution path and whether the feed is degraded. The same `feedMeta` shape is included on **GET /api/prices/enhanced** and **GET /api/portfolio/{id}/rebalance-plan** as `priceFeedMeta`.

### Execute rebalance

```http
POST /api/portfolio/{id}/rebalance
Content-Type: application/json

{}
```

or with options:

```json
{
  "options": {
    "simulateOnly": false,
    "ignoreSafetyChecks": false
  }
}
```

For more examples and exact request/response shapes, use **Swagger UI** at `/api-docs` or the **OpenAPI spec** at `/api-docs/openapi.json`.
