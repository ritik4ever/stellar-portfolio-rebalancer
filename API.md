# Stellar Portfolio Rebalancer — API Reference

Complete reference for the Stellar Portfolio Rebalancer HTTP API. All endpoints return JSON and are relative to the base URL.

## Base URL

| Environment | Base URL |
|-------------|----------|
| Development | `http://localhost:3001` |
| Production | Your deployed backend URL |

All paths below are relative to the base URL.

## API Versioning

| Namespace | Purpose |
|-----------|---------|
| `/api/v1/*` | **Current stable version.** New clients should use this namespace. Responses do not include deprecation headers. |
| `/api/*` | **Legacy compatibility.** May include `Deprecation`, `Sunset`, and `Link` headers per RFC 8594. Migrate to `/api/v1/*`. |
| `/api/auth/*` | Authentication endpoints (not versioned). See [Authentication](#authentication). |

- Frontend uses `/api/v1` by default via `VITE_API_VERSION` in `frontend/src/config/api.ts`.
- Set `VITE_USE_LEGACY_API=true` only for emergency rollback.

### Version Lifecycle

- **Stable:** `/api/v1/*` is the current stable API.
- **Deprecation:** Legacy `/api/*` routes may be deprecated. When deprecated, responses include `Sunset` header with the retirement date.
- **Migration:** New features are added to `/api/v1/*` first. Backward-compatible fixes may appear in both namespaces until legacy is retired.

## Authentication

JWT authentication is optional and disabled by default. Enable it by setting `JWT_SECRET` in the backend environment.

### Wallet-based Authentication Flow

1. **Request challenge:**
   ```bash
   POST /api/auth/challenge
   {
     "address": "GALPHABET..."
   }
   ```

2. **Sign challenge** with your Stellar wallet private key (Ed25519).

3. **Login:**
   ```bash
   POST /api/auth/login
   {
     "address": "GALPHABET...",
     "signature": "base64-encoded-signature"
   }
   ```

4. **Use access token** in subsequent requests:
   ```bash
   Authorization: Bearer <access_token>
   ```

5. **Refresh token** when access token expires:
   ```bash
   POST /api/auth/refresh
   { "refreshToken": "<refresh_token>" }
   ```

6. **Logout:**
   ```bash
   POST /api/auth/logout
   Authorization: Bearer <access_token>
   { "refreshToken": "<refresh_token>" }
   ```

### Protected Endpoints

Most endpoints are public. JWT is required for:
- `/api/auth/*` endpoints
- Managing other users' data
- Admin endpoints (`/api/admin/*`, `/api/debug/*`)
- Some portfolio operations when auth is enabled and `ALLOW_PUBLIC_USER_PORTFOLIOS_IN_DEMO` is false

### Demo Mode

When `DEMO_MODE=true`, the API operates in a read-only/simulated mode suitable for testing without real Stellar transactions.

## Error Responses

All errors follow this structure:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": {}
  },
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

### Error Codes

| Code | HTTP Status | Description | Remediation |
|------|-------------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request body or parameters | Check request schema |
| `UNAUTHORIZED` | 401 | Missing or invalid JWT | Obtain valid token |
| `FORBIDDEN` | 403 | Insufficient permissions | Verify user role/consent |
| `NOT_FOUND` | 404 | Resource doesn't exist | Verify ID/path params |
| `CONFLICT` | 409 | Idempotency conflict or state conflict | Retry with same key or resolve state |
| `RATE_LIMITED` | 429 | Rate limit exceeded | Implement exponential backoff |
| `SERVICE_UNAVAILABLE` | 503 | Downstream service unavailable | Retry later |
| `INTERNAL_ERROR` | 500 | Unexpected error | Contact support |

### Rate Limiting

| Tier | Limit | Window |
|------|-------|--------|
| Public reads | 100 req | 1 minute |
| Authenticated | 200 req | 1 minute |
| Admin writes | 50 req | 1 minute |

Rate limited responses include `Retry-After` header (seconds).

## Idempotency

Write endpoints support `Idempotency-Key` header (1–255 chars, e.g., UUID). The server caches the first successful response for 24 hours.

- **Same key + same body:** Returns cached response with `Idempotency-Replayed: true`
- **Same key + different body:** Returns `409 CONFLICT`
- **Empty/invalid key:** Returns `400 VALIDATION_ERROR`

Supported endpoints: `POST /api/portfolio`, `POST /api/portfolio/:id/rebalance`, `POST /api/rebalance/history`, `POST /api/notifications/subscribe`, `POST /api/consent`, `POST /api/admin/assets`, `PATCH /api/admin/assets/:symbol`

## Common Response Envelope

Success responses:

```json
{
  "success": true,
  "data": { /* response payload */ },
  "error": null,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "meta": { /* pagination, counts, etc. */ }
}
```

## Testnet Examples

All cURL examples below use the v1 API. Replace `http://localhost:3001` with your testnet backend URL. For demo mode, use any valid Stellar testnet address (e.g., from [Stellar Laboratory](https://laboratory.stellar.org/)).

---

## Health & System

### Health Check

```bash
GET /api/v1/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

### System Status

```bash
GET /api/v1/system/status
```

Response:
```json
{
  "system": {
    "status": "operational",
    "uptime": 12345,
    "timestamp": "2025-01-01T00:00:00.000Z",
    "version": "1.0.0"
  },
  "portfolios": { "total": 42, "active": 42 },
  "rebalanceHistory": { "total": 128 },
  "riskManagement": { "circuitBreakers": {}, "enabled": true },
  "autoRebalancer": { "status": { "isRunning": true } },
  "services": { "priceFeeds": true, "riskManagement": true },
  "featureFlags": { "demoMode": false }
}
```

### Strategies

```bash
GET /api/v1/strategies
```

Response:
```json
{
  "strategies": [
    { "id": "threshold", "name": "Threshold", "description": "..." },
    { "id": "periodic", "name": "Periodic", "description": "..." }
  ]
}
```

---

## Portfolio

### Create Portfolio

```bash
POST /api/v1/portfolio
Content-Type: application/json
Idempotency-Key: <uuid>

{
  "userAddress": "GALPHABET...",
  "allocations": { "XLM": 40, "BTC": 30, "USDC": 30 },
  "threshold": 5,
  "slippageTolerance": 1,
  "strategy": "threshold"
}
```

Response (201):
```json
{
  "success": true,
  "data": {
    "portfolioId": "portfolio-abc123",
    "status": "created",
    "mode": "onchain"
  }
}
```

Validation:
- `allocations` must sum to 100%
- `threshold`: 1–50%
- `slippageTolerance`: 0.1–5% (optional, default: 1)
- `strategy`: `threshold` | `periodic` | `volatility` | `custom` (optional, default: `threshold`)

### Get Portfolio

```bash
GET /api/v1/portfolio/{portfolioId}
```

Response:
```json
{
  "portfolio": {
    "id": "portfolio-abc123",
    "userAddress": "GALPHABET...",
    "totalValue": 10000.00,
    "allocations": [
      { "asset": "XLM", "target": 40, "current": 38.5, "amount": 3500, "balance": 9752, "price": 0.3589 }
    ],
    "needsRebalance": false,
    "lastRebalance": "2025-01-01T00:00:00.000Z",
    "threshold": 5,
    "slippageTolerancePercent": 1,
    "dayChange": 1.2
  },
  "riskHeatmap": { /* risk metrics per asset */ }
}
```

### List User Portfolios

```bash
GET /api/v1/user/{address}/portfolios
```

Response:
```json
{
  "portfolios": [ /* array of portfolio objects */ ]
}
```

### Get Rebalance Plan

```bash
GET /api/v1/portfolio/{portfolioId}/rebalance-plan
```

Response:
```json
{
  "portfolioId": "portfolio-abc123",
  "totalValue": 10000.00,
  "maxSlippagePercent": 1,
  "estimatedSlippageBps": 100,
  "prices": { "XLM": { "price": 0.3589, "change": -0.5 } },
  "priceFeedMeta": { /* feed metadata */ }
}
```

### Execute Rebalance

```bash
POST /api/v1/portfolio/{portfolioId}/rebalance
Content-Type: application/json
Idempotency-Key: <uuid>

{
  "options": {
    "simulateOnly": false,
    "ignoreSafetyChecks": false,
    "slippageOverrides": { "XLM": 0.5 }
  }
}
```

Response:
```json
{
  "result": {
    "status": "completed",
    "txHash": "abc123...",
    "trades": 3,
    "gasUsed": "50000"
  }
}
```

### Rebalance Estimate

```bash
GET /api/v1/portfolio/{portfolioId}/rebalance-estimate
```

Response:
```json
{
  "estimatedGas": "55000",
  "estimatedCost": "0.05",
  "canExecute": true
}
```

---

## Drafts

### Create Draft

```bash
POST /api/v1/portfolio/draft
Content-Type: application/json
Idempotency-Key: <uuid>

{
  "userAddress": "GALPHABET...",
  "allocations": { "XLM": 50, "USDC": 50 },
  "threshold": 3,
  "label": "My conservative draft"
}
```

Response (201):
```json
{
  "draftId": "draft-xyz789",
  "status": "draft_created"
}
```

### Get Draft

```bash
GET /api/v1/portfolio/draft/{draftId}
```

### Update Draft

```bash
PATCH /api/v1/portfolio/draft/{draftId}
Content-Type: application/json
Idempotency-Key: <uuid>

{
  "allocations": { "XLM": 60, "USDC": 40 },
  "threshold": 4
}
```

### Publish Draft

```bash
POST /api/v1/portfolio/draft/{draftId}/publish
Idempotency-Key: <uuid>
```

Response (201):
```json
{
  "portfolioId": "portfolio-abc123",
  "status": "published"
}
```

### Delete Draft

```bash
DELETE /api/v1/portfolio/draft/{draftId}
```

### List User Drafts

```bash
GET /api/v1/user/{address}/drafts
```

---

## Portfolio Export (GDPR Data Portability)

### Start Export Job

```bash
GET /api/v1/portfolio/{portfolioId}/export?format=json
# or format=csv, format=pdf
```

Response (202):
```json
{
  "jobId": "job-123456",
  "status": "processing"
}
```

### Get Export Status/Result

```bash
GET /api/v1/portfolio/{portfolioId}/export/status/{jobId}
```

Response (processing):
```json
{
  "status": "processing",
  "state": "waiting"
}
```

Response (completed):
Returns the file directly with appropriate `Content-Type` and `Content-Disposition` headers.

---

## Analytics

### Portfolio Analytics

```bash
GET /api/v1/portfolio/{portfolioId}/analytics?days=30
```

Response:
```json
{
  "portfolioId": "portfolio-abc123",
  "data": [
    { "date": "2025-01-01", "value": 10000, "change": 0 }
  ],
  "meta": { "count": 30, "period": "30 days" }
}
```

### Performance Summary

```bash
GET /api/v1/portfolio/{portfolioId}/performance-summary
```

Response:
```json
{
  "portfolioId": "portfolio-abc123",
  "totalReturn": 5.2,
  "annualizedReturn": 12.5,
  "sharpeRatio": 1.8,
  "maxDrawdown": -3.5,
  "volatility": 8.2
}
```

### Risk Diagnostics

```bash
GET /api/v1/portfolio/{portfolioId}/risk-diagnostics
```

Response:
```json
{
  "riskHeatmap": { /* per-asset risk scores */ }
}
```

---

## Rebalance History

### List History

```bash
GET /api/v1/rebalance/history?portfolioId=portfolio-abc123&limit=50&source=onchain
```

Query params:
- `portfolioId` (optional): Filter by portfolio
- `limit` (optional): 1–500, default: 50
- `offset` (optional): Pagination offset
- `source` (optional): `offchain` | `simulated` | `onchain`
- `startTimestamp`, `endTimestamp` (optional): ISO 8601
- `syncOnChain` (optional): `true` to sync on-chain first

Response:
```json
{
  "history": [
    {
      "id": "event-1",
      "portfolioId": "portfolio-abc123",
      "timestamp": "2025-01-01T00:00:00.000Z",
      "status": "completed",
      "trigger": "manual",
      "trades": 3,
      "gasUsed": "50000"
    }
  ],
  "pagination": { "limit": 50, "offset": 0, "count": 1 }
}
```

### Record Rebalance Event

```bash
POST /api/v1/rebalance/history
Content-Type: application/json
Idempotency-Key: <uuid>

{
  "portfolioId": "portfolio-abc123",
  "trigger": "auto",
  "trades": 2,
  "gasUsed": "45000",
  "status": "completed",
  "isAutomatic": true
}
```

### Sync On-Chain History

```bash
POST /api/v1/rebalance/history/sync-onchain
```

### Rebalance Summary

```bash
GET /api/v1/rebalance/summary/{portfolioId}
```

Response:
```json
{
  "portfolioId": "portfolio-abc123",
  "readiness": {
    "systemReady": true,
    "canExecute": true,
    "checks": { "database": "ready", "queue": "ready", "workers": "ready" }
  },
  "drift": { "needsRebalance": true, "maxDriftPercent": 6.5, "exceedsThreshold": true },
  "slippage": { "maxSlippagePercent": 1, "estimatedSlippageBps": 100 },
  "risk": { "allowed": true, "overallRiskLevel": "low", "alerts": [] },
  "dataFreshness": { "ageSeconds": 12, "isStale": false }
}
```

---

## Auto-Rebalancer

### Get Status

```bash
GET /api/v1/auto-rebalancer/status
```

Response:
```json
{
  "status": { "isRunning": true, "initialized": true },
  "statistics": { "totalRebalances": 42, "successRate": 0.95 }
}
```

### Start/Stop

```bash
POST /api/v1/auto-rebalancer/start
POST /api/v1/auto-rebalancer/stop
```

### Force Check

```bash
POST /api/v1/auto-rebalancer/force-check
```

### Dry-Run (Admin)

```bash
POST /api/v1/auto-rebalancer/dry-run/{portfolioId}
```

### Auto-Rebalance History

```bash
GET /api/v1/auto-rebalancer/history?portfolioId=portfolio-abc123&limit=20
```

---

## Risk

### Risk Metrics

```bash
GET /api/v1/risk/metrics/{portfolioId}
```

Response:
```json
{
  "portfolioId": "portfolio-abc123",
  "riskMetrics": {
    "volatility": 0.15,
    "concentrationRisk": 0.32,
    "liquidityRisk": 0.08,
    "var95": -0.025
  },
  "recommendations": [ "Reduce concentration in XLM" ],
  "circuitBreakers": { "volatility": { "isTriggered": false } }
}
```

### Risk Check

```bash
GET /api/v1/risk/check/{portfolioId}
```

Response:
```json
{
  "portfolioId": "portfolio-abc123",
  "allowed": true,
  "reason": null,
  "riskMetrics": { /* ... */ }
}
```

---

## Prices & Market

### Current Prices

```bash
GET /api/v1/prices
```

Response:
```json
{
  "prices": {
    "XLM": { "price": 0.3589, "change": -0.5, "timestamp": 1706880000, "source": "coingecko" }
  },
  "feedMeta": { "degraded": false, "sources": ["coingecko"] }
}
```

### Enhanced Prices

```bash
GET /api/v1/prices/enhanced
```

Response:
```json
{
  "prices": {
    "XLM": { "price": 0.3589, "change": -0.5, "riskAlerts": [], "volatilityLevel": "low" }
  },
  "riskAlerts": [],
  "feedMeta": { /* ... */ }
}
```

### Market Details

```bash
GET /api/v1/market/{asset}/details
```

### Price Chart

```bash
GET /api/v1/market/{asset}/chart?days=7
```

Response:
```json
{
  "asset": "XLM",
  "data": [ { "timestamp": 1706880000, "price": 0.35 } ],
  "timeframe": "7d",
  "dataPoints": 168
}
```

---

## Assets

### List Assets

```bash
GET /api/v1/assets?enabledOnly=true&page=1&limit=20&sortBy=symbol&order=asc
```

Query params:
- `enabledOnly` (optional): `true` to show only enabled assets
- `code` / `search` / `q`: Search by symbol/name
- `issuer`: Filter by issuer address
- `sortBy`: `symbol` | `name` | `enabled`
- `order`: `asc` | `desc`
- `page`, `limit`: Pagination (max 100)

Response:
```json
{
  "assets": [
    {
      "symbol": "XLM",
      "name": "Stellar Lumens",
      "enabled": true,
      "contractAddress": null,
      "issuerAccount": null,
      "coingeckoId": "stellar"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 50 }
}
```

### Get Asset

```bash
GET /api/v1/assets/{symbol}
```

---

## Notifications

### Subscribe

```bash
POST /api/v1/notifications/subscribe
Content-Type: application/json
Idempotency-Key: <uuid>

{
  "userId": "GALPHABET...",
  "emailEnabled": true,
  "emailAddress": "user@example.com",
  "webhookEnabled": false,
  "webhookUrl": null,
  "digestMode": false,
  "events": ["rebalance", "priceMovement"]
}
```

### Get Preferences

```bash
GET /api/v1/notifications/preferences?userId=GALPHABET...
```

### Unsubscribe

```bash
DELETE /api/v1/notifications/unsubscribe?userId=GALPHABET...&reason=no-longer-needed
```

### Notification Logs

```bash
GET /api/v1/notifications/logs?userId=GALPHABET...
```

---

## Consent (GDPR)

### Get Consent Status

```bash
GET /api/v1/consent/status?userId=GALPHABET...
```

Response:
```json
{
  "accepted": true,
  "termsAcceptedAt": "2025-01-01T00:00:00.000Z",
  "privacyAcceptedAt": "2025-01-01T00:00:00.000Z",
  "active": true
}
```

### Grant Consent

```bash
POST /api/v1/consent/grant
Content-Type: application/json
Idempotency-Key: <uuid>

{
  "userId": "GALPHABET...",
  "terms": true,
  "privacy": true,
  "cookies": true,
  "documentText": "v2025.01"
}
```

### Revoke Consent

```bash
POST /api/v1/consent/revoke
Content-Type: application/json
Idempotency-Key: <uuid>

{
  "userId": "GALPHABET..."
}
```

### Consent Audit Log

```bash
GET /api/v1/consent/audit?userId=GALPHABET...
```

### Delete User Data (GDPR Erasure)

```bash
DELETE /api/v1/user/{address}/data
Authorization: Bearer <access_token>
```

---

## Admin

> Admin routes require `Authorization: Bearer <admin_token>` and `ADMIN_PUBLIC_KEYS` to include your address.

### List All Assets (Including Disabled)

```bash
GET /api/v1/admin/assets
Authorization: Bearer <admin_token>
```

### Add Asset

```bash
POST /api/v1/admin/assets
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "symbol": "NEW",
  "name": "New Asset",
  "contractAddress": "C...",
  "issuerAccount": "G...",
  "coingeckoId": "new-asset"
}
```

### Update Asset

```bash
PATCH /api/v1/admin/assets/{symbol}
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "enabled": true,
  "quarantined": false
}
```

### Remove Asset

```bash
DELETE /api/v1/admin/assets/{symbol}
Authorization: Bearer <admin_token>
```

---

## Debug

> Debug routes are disabled in production (`NODE_ENV=production`).

### Test Notification

```bash
POST /api/v1/debug/notifications/test
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "userId": "GALPHABET...",
  "eventType": "rebalance"
}
```

### Force Fresh Prices

```bash
GET /api/v1/debug/force-fresh-prices
Authorization: Bearer <admin_token>
```

### Env Info

```bash
GET /api/v1/debug/env
Authorization: Bearer <admin_token>
```

---

## OpenAPI & Tools

- **Swagger UI:** `http://localhost:3001/api-docs`
- **OpenAPI JSON:** `http://localhost:3001/api-docs.json`
- **Postman:** Import from URL above or `backend/openapi.json` after running `npm run openapi:export`

## Maintenance

- **Authoritative spec:** `backend/src/openapi/spec.ts`
- **Generated artifacts:** `backend/openapi.json`
- **Validate sync:** `cd backend && npm run api:validate`
- **Export:** `cd backend && npm run openapi:export`

CI fails if docs are out of sync.