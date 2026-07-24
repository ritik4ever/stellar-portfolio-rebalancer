# Contract ABI and Invariants

This document outlines the ABI and key invariants of the Stellar Portfolio Rebalancer Soroban contract.

## Property-Based Invariants

The contract's pure business logic is verified using property-based testing (via the `proptest` crate). The following invariants hold across 10,000 randomly-generated inputs per property:

### P1: Allocation Sum Invariant
- **Description:** A portfolio's target allocations must always sum to exactly 100.
- **Invariant Statement:** Any non-empty vector of `u32` percentages that sums to 100 with no zeroes is accepted by `validate_allocations`. Any vector that sums to a value other than 100, is empty, or contains a zero is rejected.

### P2: Drift Range Invariant
- **Description:** Portfolio drift is the absolute percentage-point difference between the current allocation and the target allocation.
- **Invariant Statement:** For any current percentage `c ∈ [0, 100]` and target percentage `t ∈ [1, 100]`:
  - `compute_drift(c, t) ∈ [0, 100]`
  - Drift is symmetric: `compute_drift(a, b) == compute_drift(b, a)`
  - Drift is zero when equal: `compute_drift(p, p) == 0`

### P3: Rebalance Idempotency
- **Description:** Rebalancing a portfolio that is already at its target allocation produces no trades.
- **Invariant Statement:** When `current_balance == target_balance`, the computed trade amount is exactly `0`. Furthermore, trade signs correctly reflect the weight direction (over-weight produces a sell/≤0; under-weight produces a buy/≥0).
