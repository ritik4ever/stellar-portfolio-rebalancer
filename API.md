# Stellar Portfolio Rebalancer — API

This document describes the HTTP API for the Stellar Portfolio Rebalancer backend. For full request/response schemas and try-it-now usage, use the **OpenAPI 3.0** spec and **Swagger UI**.

## Quick links

| Resource | URL / action |
|----------|----------------|
| **Swagger UI** (interactive docs) | [http://localhost:3000/api-docs](http://localhost:3000/api-docs) (when backend is running) |
| **OpenAPI 3.0 spec (JSON)** | [http://localhost:3000/api-docs/openapi.json](http://localhost:3000/api-docs/openapi.json) — use this URL to import into **Postman** (Import → Link) or other tools |
| **Postman collection** | Import the OpenAPI spec: see [Postman collection](#postman-collection) below |

## Base URL

- **Development:** `http://localhost:3000` (or the port set by `PORT`)
- **Production:** Your deployed backend URL

All API routes below are relative to the base URL. The main API prefix is `/api`.

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

## Endpoints overview

### Health and info

- **GET /** — API info, version, feature flags, and endpoint list.
- **GET /health** — Health check; includes auto-rebalancer status.

### Portfolio

- **POST /api/portfolio** — Create portfolio (`userAddress`, `allocations`, `threshold`, optional `slippageTolerance`). Allocations must sum to 100%; threshold 1–50%.
- **GET /api/portfolio/:id** — Get portfolio by ID.
- **GET /api/user/:address/portfolios** — List portfolios for a Stellar address.
- **GET /api/portfolio/:id/rebalance-plan** — Get rebalance plan (total value, slippage, prices).
- **POST /api/portfolio/:id/rebalance** — Execute rebalance (body optional: `{ options: { simulateOnly, ignoreSafetyChecks, slippageOverrides } }`).
- **GET /api/portfolio/:id/analytics** — Analytics time series (query: `days`, default 30).
- **GET /api/portfolio/:id/performance-summary** — Performance summary.

### Rebalance history

- **GET /api/rebalance/history** — List rebalance events (query: `portfolioId`, `limit`, `source`, `startTimestamp`, `endTimestamp`, `syncOnChain`).
- **POST /api/rebalance/history** — Record a rebalance event (idempotent).
- **POST /api/rebalance/history/sync-onchain** — Sync on-chain rebalance history (admin).

### Risk

- **GET /api/risk/metrics/:portfolioId** — Risk metrics and recommendations.
- **GET /api/risk/check/:portfolioId** — Check if rebalance is allowed (risk check).

### Prices and market

- **GET /api/prices** — Current asset prices (e.g. XLM, BTC, ETH, USDC).
- **GET /api/prices/enhanced** — Prices with risk/volatility info.
- **GET /api/market/:asset/details** — Market details for one asset.
- **GET /api/market/:asset/chart** — Price history for charting (query: `days`, default 7).

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

- **POST /api/notifications/subscribe** — Subscribe (userId, email/webhook, events).
- **GET /api/notifications/preferences** — Get preferences (query: `userId`).
- **DELETE /api/notifications/unsubscribe** — Unsubscribe (query: `userId`).

## OpenAPI 3.0 specification

The API is described in full by an **OpenAPI 3.0** specification:

- **Served by backend:** When the backend is running, the spec is available at:
  - **JSON:** `GET /api-docs/openapi.json`
- **Swagger UI** at `/api-docs` uses this spec and provides:
  - All endpoints with descriptions
  - Request and response schemas
  - Examples and try-it-now (against the running server)

Third-party integration (e.g. code generation, API gateways, testing) can use the same OpenAPI spec.

## Postman collection

You can use the OpenAPI spec as a Postman collection source:

1. **Import from URL (recommended)**  
   - In Postman: **Import** → **Link**.  
   - Enter: `http://localhost:3000/api-docs/openapi.json`  
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
