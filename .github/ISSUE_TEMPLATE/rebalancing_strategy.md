---
name: Rebalancing strategy
about: Propose a new rebalancing strategy or modify an existing one
title: "[Strategy] "
labels: enhancement
assignees: ""
---

## Strategy summary

A short, descriptive summary of the proposed rebalancing strategy.

## Motivation

Why is this strategy needed? What portfolio scenarios does it address?

## Strategy details

### Allocation rules

Describe how the strategy determines target allocations:

- **Asset universe:** What assets can be included?
- **Weighting method:** Equal-weight / market-cap / risk-parity / custom
- **Rebalance trigger:** Time-based / threshold-based / volatility-based
- **Threshold tolerance:** What deviation triggers a rebalance?

### Execution

- **Trade execution:** DEX path payments / AMM swaps / hybrid
- **Slippage tolerance:** Default and configurable values
- **Gas/fee optimization:** Any special considerations for Stellar network fees

### Safety

- **Circuit breakers:** Conditions that pause auto-rebalancing
- **Risk checks:** Slippage limits, liquidity requirements, max trade size
- **Fallback behavior:** What happens if execution fails?

## Acceptance criteria

- [ ] Strategy is documented in `docs/REBALANCING_STRATEGIES.md`
- [ ] Strategy configuration schema is validated by Zod
- [ ] Unit tests cover edge cases (empty portfolio, max allocation, single asset)
- [ ] Risk check integration is tested
- [ ] Strategy is selectable from the frontend portfolio creation form

## Examples

Provide concrete portfolio examples that demonstrate the strategy:

**Example 1:** Conservative (80% USDC, 20% XLM)
- Threshold: 5%
- Rebalance: Monthly
- ...

**Example 2:** Aggressive (40% XLM, 30% ETH, 30% BTC)
- Threshold: 10%
- Rebalance: Weekly
- ...

## References

- Related issues, PRs, or external research
- Link to existing strategy in `docs/REBALANCING_STRATEGIES.md`

## Additional context

Any mockups, diagrams, or notes.
