Closes #995

## Summary

Implements a paginated, filterable **rebalance history endpoint** at `GET /portfolio/:id/rebalance-history` that returns past rebalance outcomes for a given portfolio, including failed rebalances with error reasons.

---

## What was added

### New endpoint: `GET /portfolio/:id/rebalance-history`

Returns a paginated list of past rebalances for a portfolio. Each record includes:

| Field | Description |
|-------|-------------|
| `timestamp` | ISO-8601 datetime of the rebalance |
| `trigger` | Raw trigger description |
| `triggerType` | Normalized: `manual`, `auto`, or `circuit_breaker` |
| `assetsTrades` | Number of asset trades executed |
| `totalFeeXlm` | Total gas fee in XLM (null if unavailable) |
| `totalFeeUsd` | Total gas fee in USD (null if unavailable) |
| `totalSlippageBps` | Total slippage in basis points (null if unavailable) |
| `status` | `success`, `partial`, or `failed` |
| `errorReason` | Error description for failed rebalances (null otherwise) |

### Query Parameters (Filters)

| Param | Type | Description |
|-------|------|-------------|
| `from` | ISO-8601 string | Lower-bound timestamp filter (inclusive) |
| `to` | ISO-8601 string | Upper-bound timestamp filter (inclusive) |
| `trigger_type` | `manual` \| `auto` \| `circuit_breaker` | Filter by trigger type |
| `status` | `success` \| `partial` \| `failed` | Filter by rebalance outcome |
| `page` | integer (default: 1) | Page number |
| `page_size` | integer (default: 50, max: 500) | Records per page |
| `sort` | `asc` \| `desc` (default: desc) | Sort order by timestamp |

### Response Shape

```json
{
  "data": {
    "history": [ /* PortfolioRebalanceHistoryItem[] */ ],
    "pagination": {
      "page": 1,
      "pageSize": 50,
      "total": 127,
      "totalPages": 3
    },
    "filters": {
      "from": null,
      "to": null,
      "trigger_type": null,
      "status": null
    }
  }
}
```

### Acceptance Criteria

- ✅ All rebalance outcomes recorded and returned (success, partial, failed)
- ✅ Failed rebalances include `errorReason` field with the failure description
- ✅ Response time monitoring: queries exceeding 200ms are logged as warnings
- ✅ Paginated with `page`, `page_size`, `total`, `totalPages`
- ✅ Filterable by `from`, `to`, `trigger_type`, `status`

---

## Files Changed

### New files
- `backend/src/test/rebalanceHistory.routes.test.ts` — Unit tests covering: 404 for missing portfolio, default pagination, filter passthrough, failed event error reasons, and totalPages calculation.

### Modified files
- `backend/src/api/portfolios.routes.ts` — Added `GET /portfolio/:id/rebalance-history` route
- `backend/src/api/validation.ts` — Added `portfolioRebalanceHistoryQuerySchema` with Zod validation for all query parameters
- `backend/src/db/rebalanceHistoryDb.ts` — Added `dbGetPortfolioRebalanceHistory()` — parameterised SQL query with dynamic WHERE clause construction, COUNT for total, and status/trigger mapping
