# Historical Rebalancing Backtest & Window Boundary Handling

> **Issue reference:** SPR-2026-151 (`#2075`)  
> **API endpoint:** `POST /api/v1/backtest` (legacy alias: `POST /api/backtest`)

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

## Error Handling

| Status | Code | Reason |
|--------|------|--------|
| `422`  | `VALIDATION_ERROR` | Allocations do not sum to 100%, threshold < 1% or > 50%, or invalid date range. |
| `503`  | `HISTORICAL_DATA_UNAVAILABLE` | External market price history provider is down or rate-limited. Synthetic fallbacks are prohibited. |
| `500`  | `INTERNAL_ERROR` | Unexpected simulation failure. |
