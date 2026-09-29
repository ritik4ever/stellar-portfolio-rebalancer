# Advanced

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
  - 48,000 XLM = $6,000
  - 4,000 USDC = $4,000

**Step 1: Check whether rebalancing should trigger**

Current allocations are 60% XLM and 40% USDC. Compared with the 50/50 target, both assets are 10 percentage points away from target, which is above the 5% threshold. The portfolio should rebalance.

**Step 2: Calculate the target values**

- Target XLM value: $5,000
- Target USDC value: $5,000

**Step 3: Calculate the trade amounts**

To move from $6,000 XLM down to $5,000 XLM, the portfolio must sell $1,000 of XLM.

- XLM sold: 8,000 XLM ($1,000 / $0.125)
- USDC bought: 1,000 USDC ($1,000 / $1.00)

**Expected rebalance plan output**

```json
{
  "portfolioId": "42",
  "totalValue": 10000,
  "assets": [
    {
      "asset": "XLM",
      "action": "sell",
      "currentBalance": 48000,
      "currentValue": 6000,
      "currentAllocationPercent": 60,
      "targetAllocationPercent": 50,
      "targetValue": 5000,
      "driftPercent": 10,
      "sellAmount": 8000,
      "tradeValue": 1000,
      "projectedBalance": 40000,
      "projectedValue": 5000,
      "projectedAllocationPercent": 50,
      "price": 0.125
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
  }
}
```

That output matches the expected result: the rebalance removes the 10-point drift on XLM, restores the target 50/50 split, and leaves the portfolio at the same total value before any fees or slippage adjustments.
