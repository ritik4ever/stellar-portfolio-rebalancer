//! Property-based integration tests for the Stellar Portfolio Rebalancer
//! Soroban contract.
//!
//! These tests use the [`proptest`] crate to verify mathematical invariants of
//! the contract's pure business logic across 10,000 randomly-generated inputs
//! per property.  Because Soroban's `Env` is not available in integration test
//! context, type-independent invariants are expressed over the **pure helper
//! functions** that are re-implemented inline here (e.g. validation and drift),
//! while balance/value arithmetic re-uses the shared `portfolio::value_to_balance`
//! function from the production crate so that scaling regressions are caught.
//!
//! # Verified Properties
//!
//! | ID   | Property                                 | Invariant statement                                                             |
//! |------|------------------------------------------|---------------------------------------------------------------------------------|
//! | P1a  | Valid allocations accepted               | Any non-empty `u32` vector that sums to 10000 with no zeroes → `validate` = true  |
//! | P1b  | Invalid allocations rejected             | Vectors with sum ≠ 10000, zeroes, or empty → `validate` = false                  |
//! | P2a  | Drift always in `[0, 10000]`              | `compute_drift(c, t)` ∈ `[0, 10000]` for all `c ∈ [0,10000]`, `t ∈ [1,10000]`      |
//! | P2b  | Drift is symmetric                       | `drift(a, b) == drift(b, a)` for all a, b                                      |
//! | P2c  | Zero drift at equality                   | `drift(p, p) == 0` for all p                                                    |
//! | P3a  | Rebalance idempotency at zero drift      | `trade_amount == 0` when `current_balance == target_balance`                    |
//! | P3b  | Trade sign correctness                   | Over-weight → sell (≤0); Under-weight → buy (≥0)                               |
//!
//! # Running
//!
//! ```sh
//! cd contracts
//! PROPTEST_CASES=10000 cargo test --test property_tests -- --nocapture
//! ```

use proptest::prelude::*;
use portfolio_rebalancer::portfolio::value_to_balance;
use portfolio_rebalancer::types::{ALLOCATION_DENOMINATOR, DEFAULT_ASSET_DECIMALS};

// ---------------------------------------------------------------------------
// Pure helper functions — mirrors of contracts/src/portfolio.rs logic
// ---------------------------------------------------------------------------

/// Returns `true` iff the allocation slice is non-empty, every element is
/// non-zero, no overflow occurs, and the total equals exactly 10000.
///
/// Mirrors [`portfolio::validate_allocations`] in the Soroban contract,
/// which uses `ALLOCATION_DENOMINATOR = 10_000` (basis points).
fn validate_allocations_pure(allocations: &[u32]) -> bool {
    if allocations.is_empty() {
        return false;
    }
    let mut total: u32 = 0;
    for &pct in allocations {
        if pct == 0 {
            return false;
        }
        total = match total.checked_add(pct) {
            Some(t) => t,
            None => return false, // overflow → invalid
        };
    }
    total == 10000
}

/// Computes the absolute percentage-point drift between `current_percent` and
/// `target_percent`.
///
/// Mirrors the drift calculation inside `build_rebalance_preview` in the
/// Soroban contract.
fn compute_drift(current_percent: u32, target_percent: u32) -> u32 {
    if current_percent >= target_percent {
        current_percent - target_percent
    } else {
        target_percent - current_percent
    }
}

/// Computes the required trade amount to bring `current_balance` in line with
/// the `target_percent` allocation of `total_value` at the given `price`.
///
/// Returns `target_balance − current_balance`.
/// Delegates to the production [`portfolio::value_to_balance`] so that the
/// property test exercises the same arithmetic as `calculate_rebalance_trades`.
fn compute_trade_amount(
    current_balance: i128,
    target_percent: u32,
    total_value: i128,
    price: i128,
) -> i128 {
    let target_value = (total_value * target_percent as i128) / ALLOCATION_DENOMINATOR as i128;
    let target_balance = value_to_balance(target_value, price, DEFAULT_ASSET_DECIMALS);
    target_balance - current_balance
}

// ---------------------------------------------------------------------------
// P1 – Allocation sum invariant
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]

    /// **P1a** – A valid allocation vector (non-empty, all non-zero, sums to 10000)
    /// must always be accepted by `validate_allocations_pure`.
    #[test]
    fn property_valid_allocations_always_accepted(
        // Generate 1–9 parts whose sum < 10000, then append the remainder to
        // make the total exactly 10000.
        parts in proptest::collection::vec(1u32..=9997u32, 1..=9usize),
    ) {
        let sum: u64 = parts.iter().map(|&x| x as u64).sum();
        // Skip inputs where the partial sum already reaches or exceeds 10000,
        // or the remainder would be 0 (violating the non-zero constraint).
        prop_assume!(sum < 10000);
        let remainder = 10000u32 - sum as u32;
        prop_assume!(remainder >= 1);

        let mut allocations = parts.clone();
        allocations.push(remainder);

        prop_assert!(
            validate_allocations_pure(&allocations),
            "expected valid for {:?} (sum=10000)", allocations
        );
    }

    /// **P1b** – Any allocation vector that does NOT satisfy the invariant must
    /// always be rejected.
    ///
    /// We categorise invalid vectors as:
    ///   • empty
    ///   • containing a zero element
    ///   • summing to a value other than 10000
    #[test]
    fn property_invalid_allocations_always_rejected(
        raw in proptest::collection::vec(0u32..=20000u32, 0..=12usize),
    ) {
        let real_sum: u64 = raw.iter().map(|&x| x as u64).sum();
        let has_zero  = raw.iter().any(|&x| x == 0);
        let is_empty  = raw.is_empty();

        let should_be_invalid = is_empty || has_zero || real_sum != 10000;

        if should_be_invalid {
            prop_assert!(
                !validate_allocations_pure(&raw),
                "expected invalid for {:?} (sum={}, has_zero={}, empty={})",
                raw, real_sum, has_zero, is_empty
            );
        }
    }
}

// ---------------------------------------------------------------------------
// P2 – Drift range invariant
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]

    /// **P2a** – Drift is always within `[0, 10000]` for any valid current and
    /// target percentages.
    #[test]
    fn property_drift_always_in_valid_range(
        current_percent in 0u32..=10000u32,
        target_percent  in 1u32..=10000u32,
    ) {
        let drift = compute_drift(current_percent, target_percent);
        prop_assert!(
            drift <= 10000,
            "drift {} out of [0,10000] for current={} target={}",
            drift, current_percent, target_percent
        );
    }

    /// **P2b** – Drift is symmetric: `drift(a, b) == drift(b, a)`.
    #[test]
    fn property_drift_is_symmetric(
        a in 0u32..=10000u32,
        b in 0u32..=10000u32,
    ) {
        prop_assert_eq!(
            compute_drift(a, b),
            compute_drift(b, a),
            "drift not symmetric for ({}, {})", a, b
        );
    }

    /// **P2c** – Drift of equal percentages is always 0.
    #[test]
    fn property_drift_zero_when_equal(pct in 0u32..=10000u32) {
        prop_assert_eq!(
            compute_drift(pct, pct),
            0u32,
            "expected zero drift when current == target == {}", pct
        );
    }
}

// ---------------------------------------------------------------------------
// P3 – Rebalance idempotency
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]

    /// **P3a** – Rebalancing an already-balanced portfolio produces zero trade.
    ///
    /// When `current_balance == target_balance`, `compute_trade_amount` must
    /// return exactly 0 for any valid price and total_value.  Target balance
    /// is derived via the production [`portfolio::value_to_balance`] so that
    /// the full arithmetic path (including scaling) is exercised.
    #[test]
    fn property_rebalance_idempotent_at_zero_drift(
        target_percent in 1u32..=10000u32,
        total_value    in 1i128..=1_000_000_000_000i128,
        price          in 1i128..=1_000_000_000_000_000_000i128,
    ) {
        let target_value = (total_value * target_percent as i128) / ALLOCATION_DENOMINATOR as i128;
        let target_balance = value_to_balance(target_value, price, DEFAULT_ASSET_DECIMALS);

        // When current == target, trade must be 0 (idempotent).
        let trade = compute_trade_amount(target_balance, target_percent, total_value, price);

        prop_assert_eq!(
            trade,
            0i128,
            "expected zero trade (idempotent) for \
             target_percent={}, total_value={}, price={}, target_balance={}",
            target_percent, total_value, price, target_balance
        );
    }

    /// **P3b** – Trade sign is correct for over/under-weight positions.
    ///
    /// • Over-weight (current > target) → trade ≤ 0 (sell)
    /// • Under-weight (current < target) → trade ≥ 0 (buy)
    /// Target balance is derived via the production [`portfolio::value_to_balance`]
    /// so that the full arithmetic path is exercised.
    #[test]
    fn property_trade_sign_matches_weight_direction(
        target_percent in 1u32..=10000u32,
        total_value    in 1i128..=1_000_000_000_000i128,
        price          in 1i128..=1_000_000_000_000_000_000i128,
        surplus        in 1i128..=1_000_000_000i128,
    ) {
        let target_value = (total_value * target_percent as i128) / ALLOCATION_DENOMINATOR as i128;
        let target_balance = value_to_balance(target_value, price, DEFAULT_ASSET_DECIMALS);

        // Over-weight: current > target → should produce a sell (≤ 0).
        let over_balance = target_balance.saturating_add(surplus);
        let trade_over   = compute_trade_amount(over_balance, target_percent, total_value, price);
        prop_assert!(
            trade_over <= 0,
            "expected sell (≤0) for over-weight, got {} \
             (target_balance={}, current={})",
            trade_over, target_balance, over_balance
        );

        // Under-weight: current < target → should produce a buy (≥ 0).
        let under_balance = target_balance.saturating_sub(surplus).max(0);
        let trade_under   = compute_trade_amount(under_balance, target_percent, total_value, price);
        prop_assert!(
            trade_under >= 0,
            "expected buy (≥0) for under-weight, got {} \
             (target_balance={}, current={})",
            trade_under, target_balance, under_balance
        );
    }
}
