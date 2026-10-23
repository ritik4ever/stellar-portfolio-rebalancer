# Historical Rebalancing Backtest & Window Boundary Handling

> **Issue references:** SPR-2026-151 (`#2075`), SPR-2026-153 (`#2077`)  
> **API endpoints:**
> - `POST /api/v1/backtest` (legacy alias: `POST /api/backtest`)
> - `GET /api/v1/backtest/:id` (legacy alias: `GET /api/backtest/:id`)
> - `GET /api/v1/backtest` (legacy alias: `GET /api/backtest`)
> - `POST /api/v1/portfolio/:id/backtest` & `GET /api/v1/portfolio/:id/backtests`

## Overview

The Backtest service simulates portfolio threshold rebalancing over historical price windows. It replays real daily closing prices and applies the same drift-based rebalancing trigger used by the live threshold strategy:

- Rebalance back to target weights whenever any asset's drift exceeds the configured percentage-point threshold.
- Compare simulation results against a baseline buy-and-hold strategy across the exact same historical timeline.
- Rely strictly on verified historical market data without falling back to synthetic/mock prices.

---

## Service Boundary & Window Boundary Handling

When evaluating a historical backtest range, the service enforces strict boundary rules:

1. **Daily Closes Normalization:**
   Intraday price points are collapsed into UTC daily closing prices at midnight (`00:00:00 UTC`). The still-open current UTC day is excluded to avoid treating partial intraday movements as complete closes.

2. **Continuous Calendar Range:**
   The price window spans from `minWindowDay` to `maxWindowDay` (or bounded by optional `from` and `to` ISO timestamps). Every UTC calendar day in that span is evaluated.

3. **Deterministic Day Partitioning:**
   Every calendar day in the window is partitioned into either:
   - **`includedDays`**: All portfolio assets have a valid closing quote. This day is included in the simulation timeline.
   - **`absentDays` & `absentDayReasons`**: One or more assets lack price data on this day. The day is omitted from the simulation timeline, and an explicit reason is recorded.

---

## Leap Day Handling (February 29)

In leap years (e.g., 2024, 2028), February 29 is a valid calendar day. The service boundary handles leap days deterministically:

- **Quotes Available:**  
  When all assets have closing quotes on February 29 (e.g., `2024-02-29`), the leap day is included in `includedDays`. Portfolio drift and rebalancing events are evaluated on this day.
  - `decision.hasLeapDay = true`
  - `decision.leapDayIncluded = true`
  - `decision.evaluationSummary` notes that the leap day was successfully included.

- **Quotes Missing / Sparse Feed:**  
  If any asset is missing a closing quote on February 29 (e.g., market gap or provider omission), February 29 is omitted from the simulation timeline to prevent skewed or interpolated portfolio valuations.
  - Recorded in `absentDayReasons`:  
    `"2024-02-29": "Leap day price feed unavailable for asset(s): <asset>"`
  - `decision.hasLeapDay = true`
  - `decision.leapDayIncluded = false`
  - The remaining days continue to evaluate with stable, deterministic results.

---

## API Request & Response Shapes

### Request: `POST /api/v1/backtest`

```json
{
  "allocations": { "XLM": 50, "USDC": 50 },
  "threshold": 5,
  "days": 90,
  "initialValue": 10000,
  "from": "2024-02-27T00:00:00.000Z",
  "to": "2024-03-01T00:00:00.000Z"
}
```

### Response: `200 OK`

```json
{
  "success": true,
  "data": {
    "threshold": 5,
    "allocations": { "XLM": 50, "USDC": 50 },
    "startTimestamp": 1709078400,
    "endTimestamp": 1709251200,
    "startDate": "2024-02-28",
    "endDate": "2024-03-01",
    "days": 3,
    "initialValue": 10000,
    "finalValue": 10520.45,
    "totalReturnPct": 5.2,
    "buyAndHoldFinalValue": 10210.1,
    "buyAndHoldReturnPct": 2.1,
    "rebalanceCount": 1,
    "maxDrawdownPct": 3.4,
    "maxDriftObservedPct": 8.5,
    "events": [
      {
        "timestamp": 1709164800,
        "date": "2024-02-29",
        "maxDriftPct": 6.8,
        "asset": "XLM",
        "portfolioValue": 10340.2
      }
    ],
    "timeline": [
      {
        "timestamp": 1709078400,
        "date": "2024-02-28",
        "value": 10000,
        "buyAndHoldValue": 10000,
        "maxDriftPct": 0,
        "rebalanced": false
      },
      {
        "timestamp": 1709164800,
        "date": "2024-02-29",
        "value": 10340.2,
        "buyAndHoldValue": 10180.5,
        "maxDriftPct": 6.8,
        "rebalanced": true
      },
      {
        "timestamp": 1709251200,
        "date": "2024-03-01",
        "value": 10520.45,
        "buyAndHoldValue": 10210.1,
        "maxDriftPct": 1.2,
        "rebalanced": false
      }
    ],
    "includedDays": ["2024-02-28", "2024-02-29", "2024-03-01"],
    "absentDayReasons": {},
    "absentDays": [],
    "decision": {
      "status": "completed",
      "totalWindowDays": 3,
      "includedDaysCount": 3,
      "absentDaysCount": 0,
      "hasLeapDay": true,
      "leapDayIncluded": true,
      "includedDays": ["2024-02-28", "2024-02-29", "2024-03-01"],
      "absentDayReasons": {},
      "evaluationSummary": "Evaluated 3 of 3 window days; leap day (Feb 29) successfully included."
    },
    "simulated": true,
    "dataSource": "coingecko_market_chart",
    "disclaimer": "Historical simulation only. Replays past daily closing prices and ignores fees, slippage and execution timing. Past performance does not guarantee future results."
  }
}
```

---

## State Consistency & Persistence (SPR-2026-153)

The backtest service guarantees state consistency across execution success, failure, and concurrent work:

### 1. Agreement After Success
- When a backtest price window simulation succeeds, a record is persisted with `status: 'completed'`.
- The persisted record's fields (`includedDays`, `absentDayReasons`, `absentDays`, `decision`, `events`, and performance metrics) agree 100% with the externally visible API response.
- Persisted records can be retrieved anytime via `GET /api/v1/backtest/:id` or listed via `GET /api/v1/backtest?status=completed`.

### 2. Agreement After Failure & Interrupted Work
- If market history collection fails (e.g., provider HTTP 503/429), or an unhandled error interrupts execution, the record is immediately saved with `status: 'failed'` and the exact sanitized error message returned to the caller (`error.message`).
- Failure records retain empty `includedDays` and `absentDayReasons` (as the simulation window could not complete), while `status`, `error`, and `updatedAt` are updated.
- The external caller receives the failure envelope containing `recordId`, enabling immediate correlation and diagnosis.

### 3. Concurrent Work Handling
- **Portfolio-Level Locking:** When running a backtest with a specific `portfolioId` (via `/api/v1/backtest` or `/api/portfolio/:id/backtest`), the service acquires a concurrency lock. Concurrent requests on the same portfolio receive `409 CONFLICT` (`Backtest already in progress for this portfolio`), preventing race conditions and corrupted records. The lock is safely released in a `finally` block on success or failure.
- **Isolated Execution State:** Independent backtests running in parallel maintain isolated `includedDays` and `absentDayReasons` arrays and maps, persisting independent records without cross-contamination.

---

## Error Handling

| Status | Code | Reason |
|--------|------|--------|
| `404`  | `NOT_FOUND` | Specified portfolio not found for backtest run (no record created). |
| `409`  | `CONFLICT` | Concurrent backtest already in progress for the specified portfolio. |
| `422`  | `VALIDATION_ERROR` | Allocations do not sum to 100%, threshold < 1% or > 50%, or invalid date range. |
| `503`  | `HISTORICAL_DATA_UNAVAILABLE` | External market price history provider is down or rate-limited. Record persisted as `failed`. |
| `500`  | `INTERNAL_ERROR` | Unexpected simulation failure (record persisted as `failed`), or portfolio retrieval error before run initialization (no record created). |

## Known feed gaps and related follow-up issues

The current fetch boundary excludes the open UTC day and filters the requested
range, but does not require a complete daily series. The simulator skips missing
days, reports them through `absentDayReasons`, and can return `completed` when at
least two overlapping days remain. Requested dates outside the returned history
can also be clipped from the evaluated window. Operators should inspect the
returned date range and absent-day details before treating a result as covering
the entire requested window.

- #2076 (SPR-2026-152): define bounded retry or explicit stop behavior for
  incomplete market history before simulation.
- #2078 (SPR-2026-154): add structured source and outcome diagnostics that
  distinguish complete history from blocked or delayed work without logging
  provider credentials.
- #2073 (SPR-2026-149): add equivalent diagnostics for the volatility pause.
  The current circuit breaker checks the configured 24h-change threshold, then
  price freshness (10 minutes), then correlation. A latest-value snapshot alone
  cannot identify every missed feed interval.

Existing coverage includes the backtest calendar/leap-day tests in
`backend/src/test/backtest.test.ts` (SPR-2026-151 / #2075), plus circuit-breaker
and shared volatility-threshold tests. Those tests do not establish complete
requested-window validation or structured missing-interval outcomes. This note
records the gaps; it does not implement the linked issues.

