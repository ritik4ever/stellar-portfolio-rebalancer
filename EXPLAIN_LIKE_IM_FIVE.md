# EXPLAIN LIKE I'M FIVE

## What problem does this repo solve?

If you own crypto, your portfolio gets messy over time. Some coins go up, some go down, and your "50% / 30% / 20%" plan goes out the window. **Stellar Portfolio Rebalancer** automatically fixes that — it sells what's overweight and buys what's underweight to get back to your target.

## How does it work in 3 bullet points?

1. **You set your target allocation** — e.g. "I want 60% XLM, 30% USDC, 10% EURMTL." The system remembers your targets.
2. **Drift is detected automatically** — when any asset strays too far from your target (say XLM goes from 60% → 75%), the system flags it for rebalancing.
3. **Rebalancing happens on Stellar** — trades execute on Stellar's DEX/Soroban to bring everything back into balance, using real-time prices from Reflector oracles.

```
  Before rebalance         After rebalance
  ┌─────────────────┐     ┌─────────────────┐
  │ ████████████████ │     │ ████████████    │  XLM 60%
  │  XLM 75%        │     │                 │
  ├─────────────────┤     ├─────────────────┤
  │ ██████          │     │ ████████████    │  USDC 30%
  │  USDC 20%       │     │                 │
  ├─────────────────┤     ├─────────────────┤
  │ ██              │     │ ████            │  EURMTL 10%
  │  5%             │     │                 │
  └─────────────────┘     └─────────────────┘
   ❌ Drifted away         ✅ Back to target
```

## Who should use this?

- **Crypto investors** who want "set and forget" portfolio management on Stellar
- **DeFi users** managing multiple Stellar assets across wallets
- **Developers** looking for a production-grade Soroban rebalancing reference implementation
- **Anyone testing Stellar DeFi** who wants to experiment with automated trading strategies
