# Advanced

<<<<<<< HEAD
> **Last verified:** 2026-09-29 against commit `ce5699b` (`backend/src/services/rebalancePlan.ts`, `docs/REBALANCING_STRATEGIES.md`, `backend/src/types/index.ts`).

=======
>>>>>>> 2e44dab7a59fbd78588429a8042fcabf8fef3e8d
This page collects a worked example for the most common rebalance case described in [docs/REBALANCING_STRATEGIES.md](docs/REBALANCING_STRATEGIES.md): a threshold-based portfolio that has drifted far enough to trigger a rebalance.

## Worked example: 60/40 portfolio drifting to 50/50

**Scenario**

- Portfolio value: $10,000
- Target allocations: 50% XLM, 50% USDC
- Rebalance threshold: 5%
- Current prices:
  - XLM = $0.125
  - USDC = $1.00
- Current balances:
<<<<<<< HEAD
  - 48,000 XLM = $6,000 (60%)
  - 4,000 USDC = $4,000 (40%)

**Step 1: Check whether rebalancing should trigger**

Current allocations are 60% XLM and 40% USDC. Compared with the 50/50 target, both assets have a drift of 10 percentage points (`|current - target|`), which is above the 5% threshold. The portfolio should rebalance.

**Step 2: Calculate the target values**

- Target XLM value: $5,000 (50% of $10,000)
- Target USDC value: $5,000 (50% of $10,000)

**Step 3: Calculate the trade amounts**

To move from $6,000 XLM down to $5,000 XLM, the portfolio must sell $1,000 of XLM. To move from $4,000 USDC up to $5,000 USDC, the portfolio must buy $1,000 of USDC.
=======
  - 48,000 XLM = $6,000
  - 4,000 USDC = $4,000

**Step 1: Check whether rebalancing should trigger**

Current allocations are 60% XLM and 40% USDC. Compared with the 50/50 target, both assets are 10 percentage points away from target, which is above the 5% threshold. The portfolio should rebalance.

**Step 2: Calculate the target values**

- Target XLM value: $5,000
- Target USDC value: $5,000

**Step 3: Calculate the trade amounts**

To move from $6,000 XLM down to $5,000 XLM, the portfolio must sell $1,000 of XLM.
>>>>>>> 2e44dab7a59fbd78588429a8042fcabf8fef3e8d

- XLM sold: 8,000 XLM ($1,000 / $0.125)
- USDC bought: 1,000 USDC ($1,000 / $1.00)

<<<<<<< HEAD
**Step 4: Fee and slippage estimation**

- **Base network fee:** 100 stroops per trade (0.00001 XLM). For 2 trades, estimated network fee is 0.00002 XLM (~$0.0000025 USD at $0.125/XLM).
- **Slippage tolerance:** 1% (100 basis points default).

=======
>>>>>>> 2e44dab7a59fbd78588429a8042fcabf8fef3e8d
**Expected rebalance plan output**

```json
{
  "portfolioId": "42",
  "totalValue": 10000,
<<<<<<< HEAD
  "maxSlippagePercent": 1,
  "estimatedSlippageBps": 100,
  "estimatedFees": {
    "xlm": 0.00002,
    "usd": 0.0000025,
    "perTradeXlm": 0.00001,
    "tradeCount": 2
  },
  "assets": [
    {
      "asset": "USDC",
      "action": "buy",
      "currentBalance": 4000,
      "currentValue": 4000,
      "currentAllocationPercent": 40,
      "targetAllocationPercent": 50,
      "targetValue": 5000,
      "driftPercent": 10,
      "buyAmount": 1000,
      "sellAmount": 0,
      "tradeValue": 1000,
      "projectedBalance": 5000,
      "projectedValue": 5000,
      "projectedAllocationPercent": 50,
      "price": 1
    },
    {
=======
  "assets": [
    {
>>>>>>> 2e44dab7a59fbd78588429a8042fcabf8fef3e8d
      "asset": "XLM",
      "action": "sell",
      "currentBalance": 48000,
      "currentValue": 6000,
      "currentAllocationPercent": 60,
      "targetAllocationPercent": 50,
      "targetValue": 5000,
      "driftPercent": 10,
<<<<<<< HEAD
      "buyAmount": 0,
=======
>>>>>>> 2e44dab7a59fbd78588429a8042fcabf8fef3e8d
      "sellAmount": 8000,
      "tradeValue": 1000,
      "projectedBalance": 40000,
      "projectedValue": 5000,
      "projectedAllocationPercent": 50,
      "price": 0.125
<<<<<<< HEAD
    }
  ],
  "projectedAllocations": {
    "USDC": 50,
    "XLM": 50
  },
  "prices": {
    "XLM": {
      "price": 0.125,
      "change": 0,
      "timestamp": 1727632800000
    },
    "USDC": {
      "price": 1,
      "change": 0,
      "timestamp": 1727632800000
    }
  },
  "priceFeedMeta": {
    "provider": "backend",
    "resolvedAtMs": 1727632800000,
    "degraded": false,
    "staleOrLimited": false,
    "resolutionHint": "fresh_primary",
    "assetsCount": 2
=======
    },
    {
      "asset": "USDC",
      "action": "buy",
      "currentBalance": 4000,
      "currentValue": 4000,
      "currentAllocationPercent": 40,
      "targetAllocationPercent": 50,
      "targetValue": 5000,
      "driftPercent": -10,
      "buyAmount": 1000,
      "tradeValue": 1000,
      "projectedBalance": 5000,
      "projectedValue": 5000,
      "projectedAllocationPercent": 50,
      "price": 1
    }
  ],
  "projectedAllocations": {
    "XLM": 50,
    "USDC": 50
>>>>>>> 2e44dab7a59fbd78588429a8042fcabf8fef3e8d
  }
}
```

<<<<<<< HEAD
That output matches the expected result: the rebalance removes the 10-point drift on XLM and USDC, restores the target 50/50 split, includes estimated network fees (2 trades = 0.00002 XLM) and slippage tolerance, and leaves the portfolio at the projected target values before transaction execution.
=======
That output matches the expected result: the rebalance removes the 10-point drift on XLM, restores the target 50/50 split, and leaves the portfolio at the same total value before any fees or slippage adjustments.
>>>>>>> 2e44dab7a59fbd78588429a8042fcabf8fef3e8d
