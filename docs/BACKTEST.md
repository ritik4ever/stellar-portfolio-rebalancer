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

## Frontend Historical simulator

The Analytics page exposes this API through `frontend/src/components/HistoricalSimulator.tsx`. Its date rules live in `frontend/src/utils/backtestWindow.ts`.

- **Allowed range:** 7 to 364 inclusive UTC days. The API accepts `days: 365`, but its 365-day lookback minus the open UTC day leaves 364 complete closes.
- **Seven-day window:** the start and end dates both count, so `2028-02-27` through `2028-03-04` is exactly 7 days. A 6-day range is blocked next to the date fields.
- **Leap day:** Feb 29 counts as a normal day when it is in the selectable range. The result states whether it was included or skipped. Impossible dates such as `2027-02-29` are rejected.
- **Range and source alignment:** the result shows the requested range, evaluated range, and data source. Changing the range clears the previous result.
- **Insufficient history:** a `HISTORICAL_DATA_UNAVAILABLE` response shows an alert with actionable recovery paths: **Retry simulation** (preserving the current date edits without duplicating in-flight requests), **Adjust dates** (focusing the start date field with existing edits intact), **Try last 7 days** (for ranges longer than 7 days, switching to the shortest valid window for review before running), and **Dismiss**. Synthetic prices are never substituted.
- **Keyboard and screen readers:** status changes are announced, focus moves to the result or error, and Escape or Cancel abandons a running request. Cancelling stops the page from waiting, but the server may finish its run, so an immediate retry can return `409 CONFLICT`.
- **Narrow screens:** controls stack and wrap at 320px and with 200% text sizing without horizontal page scrolling.

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


# API documentation

> **Last verified:** 2026-09-30 against commit `a5154c2f0deb9d75b689c13a4f5a092891b89702` on `main`.

The HTTP API (versioning, envelopes, and endpoint overview) lives in the repository root:

**[API.md](../API.md)**

## Contract error codes

When the backend invokes the on-chain Soroban contract, failures surface as numeric
error codes. The canonical mapping between contract error codes and HTTP API error
responses is maintained in:

**[CONTRACT_ABI.md → Canonical Error Mapping](../contracts/CONTRACT_ABI.md#canonical-error-mapping-contract--api)**

## Operational endpoints

These unversioned endpoints support health checks and monitoring:

| Endpoint           | Purpose                                                       |
|--------------------|--------------------------------------------------------------|
| `GET /health`      | Plain-text `200 ok` liveness probe for load balancers.       |
| `GET /api/health`  | JSON `{ status, timestamp }` API health.                     |
| `GET /ready`, `GET /readiness` | Deep readiness probe (DB, Redis/queues, workers, indexer); returns `503` until ready. |
| `GET /metrics`     | Prometheus metrics exposition.                               |

To probe these surfaces across environments, use the health smoke script (`npm run smoke`). See **[OPERATIONS.md](OPERATIONS.md#health-smoke-test)** for usage and the health-vs-readiness distinction.

### Worked example: confirm a local backend is serving

The most common case for a first-time contributor is "is the API up and healthy?". The backend listens on port `3001` by default (`PORT` overrides it), so probe `http://localhost:3001` and read the result.

The response bodies, statuses, and key names below come from the route handlers in `backend/src/index.ts` and `backend/src/api/ops.routes.ts`, and the smoke transcript is the output format of `scripts/health-smoke.sh`. Per-request timings are representative and will differ on your machine.

**Step 1 — confirm the process is bound.** Start the API from `backend/` (`npm run dev`). The bind is logged as JSON and contains:

```text
[SERVER] Listening on port 3001
```

**Step 2 — probe liveness.** This is the plain-text surface a load balancer uses:

```bash
curl -i http://localhost:3001/health
```

Expected response:

```text
HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8

ok
```

`GET /health` never calls the database, Redis, Horizon, or Soroban. A body other than `ok`, or any status other than `200`, means something other than this API is listening on port 3001.

**Step 3 — probe dependencies.** Unlike `/health`, this endpoint runs live checks and names what it found:

```bash
curl -s http://localhost:3001/api/health | jq
```

Expected response when every dependency is reachable:

```json
{
  "status": "healthy",
  "timestamp": "2026-09-30T10:31:04.882Z",
  "dependencies": {
    "database": { "status": "ok", "latency_ms": 2, "last_checked": "2026-09-30T10:31:04.880Z" },
    "redis": { "status": "ok", "latency_ms": 1, "last_checked": "2026-09-30T10:31:04.881Z" },
    "stellar_horizon": { "status": "ok", "latency_ms": 84, "last_checked": "2026-09-30T10:31:04.882Z" },
    "reflector_oracle": { "status": "ok", "latency_ms": 57, "last_checked": "2026-09-30T10:31:04.882Z" }
  }
}
```

Each dependency reports `ok`, `degraded`, or `down`. A `degraded` dependency still answers `200` with `"status": "healthy"`; only a `down` dependency flips the response to `503` with `"status": "unhealthy"`, so this object is where you find out which one broke.

**Step 4 — probe all four surfaces at once.** From the repository root:

```bash
npm run smoke
```

Expected output:

```text
Health smoke test → http://localhost:3001  (target: local, timeout: 10s)
-------------------------------------------------------------------------
  ✓ liveness    /health       200 (0.003s)
  ✓ api-health  /api/health   200 (0.041s)
  ✓ readiness   /ready        200 (0.012s)
  ✓ api-root    /             200 (0.004s)
  ✓ api-docs    /api-docs     200 (0.006s)
  ✓ metrics     /metrics      200 (0.009s)
-------------------------------------------------------------------------
Summary: 6 passed, 0 failed, 0 warning(s)
✓ Health smoke test passed for http://localhost:3001
```

Exit code `0`. `/metrics` answers `200` here because the probe comes from loopback (or because `NODE_ENV` is `development`), either of which is allowed by the metrics allowlist.

**Step 5 — read a non-zero result.** Only `liveness` and `api-health` are required, so the other four degrade to warnings and the run still exits `0`:

```text
  ⚠ readiness   /ready        WARN — expected HTTP 200, got 503
```

A warning does not gate a deploy. A `✗` on a required check does — this run exits `1`:

```text
  ✗ api-health  /api/health   FAIL — expected HTTP 200, got 503
```

The Backtest service simulates portfolio threshold rebalancing over historical price windows. It replays real daily closing prices and applies the same drift-based rebalancing trigger used by the live threshold strategy:

Rebalance back to target weights whenever any asset's drift exceeds the configured percentage-point threshold.
Compare simulation results against a baseline buy-and-hold strategy across the exact same historical timeline.
Rely strictly on verified historical market data without falling back to synthetic/mock prices.


That is the same `503` as step 3, and the `dependencies` object from `curl` is what tells you whether it was Redis, the database, Horizon, or the oracle.

On a fresh start with no Redis, `/ready` and `/readiness` legitimately return `503` with `"status": "not_ready"` — they are the same handler, and they aggregate the database, Redis/queues, queue backlog, workers, the contract event indexer, and the auto-rebalancer. That is the warning in step 5, not a failure.

## Backtest endpoints

Historical price window evaluation and state persistence for portfolio rebalancing:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/v1/backtest` | Run historical backtest across a date window or days lookback. |
| `GET` | `/api/v1/backtest/:id` | Fetch persisted backtest record by ID with verified state consistency. |
| `GET` | `/api/v1/backtest` | List persisted backtests with filters (`portfolioId`, `status`, `limit`, `offset`). |
| `POST` | `/api/portfolio/:id/backtest` | Run backtest using portfolio's target allocations and threshold. |
| `GET` | `/api/portfolio/:id/backtests` | List backtest history for a specific portfolio. |

For calendar window mechanics, leap-year boundary handling, and concurrency guarantees, see **[BACKTEST.md](BACKTEST.md)**.
