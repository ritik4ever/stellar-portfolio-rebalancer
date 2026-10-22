#![no_main]

//! Fuzz target for `calculate_rebalance_trades` overflow/underflow robustness.
//!
//! Unlike the byte-chunk targets (which hand-roll the input layout) this target
//! uses `#[derive(Arbitrary)]` over a dedicated input struct so the fuzzer can
//! treat each portfolio dimension independently. Inputs are mapped into
//! structurally valid Soroban maps and run through the real contract function:
//! the target asserts the function never panics and that every produced trade
//! stays within sane i128 bounds above the minimum trade size.

use arbitrary::{Arbitrary, Unstructured};
use libfuzzer_sys::fuzz_target;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, Map};

use portfolio_rebalancer::portfolio::{calculate_rebalance_trades, validate_allocations};
use portfolio_rebalancer::types::{
    CircuitBreakerConfig, PauseReason, Portfolio, StrategyConfig, StrategyType,
    ALLOCATION_DENOMINATOR, DEFAULT_ASSET_DECIMALS, MAX_ASSET_DECIMALS, MAX_PORTFOLIO_ASSETS,
    MIN_TRADE_AMOUNT_STROOPS,
};

/// Randomized but structurally valid portfolio/asset inputs.
#[derive(Arbitrary, Clone, Debug)]
struct FuzzTradeInput {
    /// Number of assets to build (capped at `MAX_PORTFOLIO_ASSETS`).
    num_assets: u8,
    /// Allocation basis points per asset (sum is normalised to `ALLOCATION_DENOMINATOR`).
    allocations_bps: Vec<u16>,
    /// Balance seeds per asset; sign and magnitude are derived deterministically.
    balance_seeds: Vec<u64>,
    /// Price seeds per asset; `0` exercises the zero-price division-by-zero path.
    price_seeds: Vec<u64>,
    /// Asset decimals per asset (clamped to the contract's `[0, MAX_ASSET_DECIMALS]` range).
    decimals: Vec<u32>,
    /// When the low 2 bits are clear, an extra-large `total_value` is used to
    /// stress the `target_value = total * pct / denominator` math.
    extreme_total_value: u8,
/// Normalises allocation basis points to sum exactly to `ALLOCATION_DENOMINATOR`
/// with no zero allocations, producing a portfolio that `validate_allocations`
/// accepts. Returns `None` when the input can't be normalised.
fn normalise_allocations(raw: &[u16], n: usize) -> Option<Vec<u32>> {
    if n == 0 || n > MAX_PORTFOLIO_ASSETS as usize {
        return None;
    }
    let total: u64 = raw.iter().take(n).map(|&p| p as u64).sum();
    if total == 0 {
        return None;
    }

    let mut out: Vec<u32> = raw
        .iter()
        .take(n)
        .map(|&p| ((p as u64 * ALLOCATION_DENOMINATOR as u64) / total) as u32)
        .collect();
    // `validate_allocations` rejects zero-weight assets – promote any to 1.
    for v in out.iter_mut() {
        if *v == 0 {
            *v = 1;
        }
    }

    let sum: u32 = out.iter().sum();
    if sum > ALLOCATION_DENOMINATOR {
        return None;
    }
    out[n - 1] += ALLOCATION_DENOMINATOR - sum;
    if out[n - 1] == 0 || out.iter().sum::<u32>() != ALLOCATION_DENOMINATOR {
        return None;
    }
    Some(out)
}

fuzz_target!(|data: &[u8]| {
    if data.len() < 32 {
        return;
    }

    let mut unstructured = Unstructured::new(data);
    let Ok(input) = FuzzTradeInput::arbitrary(&mut unstructured) else {
        return;
    };

    let n = (input.num_assets as usize).min(MAX_PORTFOLIO_ASSETS as usize);
    let Some(allocs) = normalise_allocations(&input.allocations_bps, n) else {
        return;
    };

    let env = Env::default();
    let mut target_allocations: Map<Address, u32> = Map::new(&env);
    let mut current_balances: Map<Address, i128> = Map::new(&env);
    let mut prices: Map<Address, i128> = Map::new(&env);
    let mut asset_decimals: Map<Address, u32> = Map::new(&env);

    for (idx, &pct) in allocs.iter().enumerate() {
        let asset = Address::generate(&env);

        let seed = input.balance_seeds.get(idx).copied().unwrap_or(0);
        // Bounded magnitude (≤ ~1e11 stroops) with a mix of positive/negative balances.
        let magnitude = (seed % 100_000_000_000) as i128;
        let balance = if seed % 7 == 0 { -magnitude } else { magnitude };

        let price_seed = input.price_seeds.get(idx).copied().unwrap_or(0);
        // 0 exercises the price==0 path; otherwise stay well inside i128 range.
        let price: i128 = if price_seed % 32 == 0 {
            0
        } else {
            (price_seed % 10_000_000_000_000) as i128
        };

        let decimals = input
            .decimals
            .get(idx)
            .copied()
            .unwrap_or(DEFAULT_ASSET_DECIMALS)
            % (MAX_ASSET_DECIMALS + 1);

        target_allocations.set(asset.clone(), pct);
        current_balances.set(asset.clone(), balance);
        prices.set(asset.clone(), price);
        asset_decimals.set(asset, decimals);
    }

    // The normalised allocations must always validate.
    assert!(
        validate_allocations(&target_allocations),
        "normalised allocations failed validation"
    );
// Total value either matches the portfolio's own compute or is an intentionally
    // extreme i128 (stresses the `total_value * pct` multiplication in the contract).
    let computed_total: i128 = {
        let mut tv = 0i128;
        for (asset, bal) in current_balances.iter() {
            if let Some(p) = prices.get(asset) {
                tv = tv.saturating_add(bal.saturating_mul(p).saturating_div(10_000_000_000_000));
            }
        }
        tv
    };
    let total_value = if input.extreme_total_value & 0b11 == 0 {
        computed_total.saturating_add(i128::from(i64::MAX)).saturating_mul(10)
    } else {
        computed_total
    };

    let user = Address::generate(&env);
    let portfolio = Portfolio {
        user,
        target_allocations,
        current_balances,
        asset_decimals,
        rebalance_threshold: 5,
        slippage_tolerance: 100,
        slippage_policy_version: 1,
        last_rebalance: 0,
        total_value,
        is_active: true,
        pause_reason: PauseReason::None,
        circuit_breaker_config: CircuitBreakerConfig {
            window_seconds: 3600,
            spike_threshold_bps: 100,
        },
        global_max_slippage_bps: 300,
        strategy: StrategyType::Threshold,
        strategy_config: StrategyConfig::default(),
    };

    // Must never panic for any input, regardless of overflow/underflow shape.
    let trades = calculate_rebalance_trades(&env, &portfolio, &prices);

    // Checked-arithmetic style assertions on everything that reaches the output:
    // trades must be above the minimum size and must not sit at i128 boundaries
    // (which would indicate silent overflow).
    for (_, amount) in trades.iter() {
        assert!(
            amount.abs() > MIN_TRADE_AMOUNT_STROOPS,
            "trade below minimum slipped through: {amount}"
        );
        assert!(
            amount > i128::MIN + MIN_TRADE_AMOUNT_STROOPS,
            "trade underflowed near i128::MIN: {amount}"
        );
        assert!(
            amount < i128::MAX - MIN_TRADE_AMOUNT_STROOPS,
            "trade overflowed near i128::MAX: {amount}"
        );
    }
});
}