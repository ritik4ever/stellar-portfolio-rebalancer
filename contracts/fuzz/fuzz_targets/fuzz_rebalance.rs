#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, Map};

use portfolio_rebalancer::portfolio::{calculate_rebalance_trades, validate_allocations};
use portfolio_rebalancer::types::{
    PauseReason, Portfolio, MAX_PORTFOLIO_ASSETS, MIN_TRADE_AMOUNT_STROOPS,
};

fuzz_target!(|data: &[u8]| {
    // Need at least one 3-byte chunk to do anything useful
    if data.len() < 3 {
        return;
    }

    let env = Env::default();
    let mut allocs: Map<Address, u32> = Map::new(&env);
    let mut balances: Map<Address, i128> = Map::new(&env);
    let mut prices: Map<Address, i128> = Map::new(&env);

    // Each 3 bytes = one asset: [allocation%, balance_seed, price_seed]
    for chunk in data.chunks(3).take(MAX_PORTFOLIO_ASSETS as usize) {
        if chunk.len() < 3 {
            break;
        }
        let asset = Address::generate(&env);
        let pct: u32 = (chunk[0] as u32 % 99) + 1;
        let balance: i128 = chunk[1] as i128 * 1_000_000_000;
        let price: i128 = if chunk[2] == 0 {
            0
        } else {
            chunk[2] as i128 * 10i128.pow(11)
        };
        allocs.set(asset.clone(), pct);
        balances.set(asset.clone(), balance);
        prices.set(asset, price);
    }

    // Path 1: validate_allocations must never panic — only return true or false
    let _ = validate_allocations(&allocs);

    if allocs.is_empty() {
        return;
    }

    // Path 2: normalise so allocations sum to exactly 100, then run rebalance math
    let keys: soroban_sdk::Vec<Address> = allocs.keys();
    let n = keys.len() as u32;
    let base: u32 = 100 / n;
    let remainder: u32 = 100 - base * n;
    let mut normalised: Map<Address, u32> = Map::new(&env);
    for (idx, key) in keys.iter().enumerate() {
        let pct = if idx as u32 == n - 1 {
            base + remainder  // last asset absorbs the leftover
        } else {
            base
        };
        normalised.set(key, pct);
    }

    let user = Address::generate(&env);
    let portfolio = Portfolio {
        user,
        target_allocations: normalised,
        current_balances: balances.clone(),
        asset_decimals: Map::new(&env),
        rebalance_threshold: 5,
        slippage_tolerance: 100,
        slippage_policy_version: 1,
        last_rebalance: 0,
        total_value: {
            let mut tv = 0i128;
            for (asset, bal) in balances.iter() {
                if let Some(p) = prices.get(asset) {
                    tv = tv.saturating_add(
                        bal.saturating_mul(p)
                            .checked_div(10i128.pow(14))
                            .unwrap_or(0),
                    );
                }
            }
            tv
        },
        is_active: true,
        pause_reason: PauseReason::None,
    };

    // Must never panic for any input
    let trades = calculate_rebalance_trades(&env, &portfolio, &prices);

    // Every trade that makes it through must be above the minimum size
    for (_, amount) in trades.iter() {
        assert!(
            amount.abs() > MIN_TRADE_AMOUNT_STROOPS,
            "trade below minimum slipped through: {amount}"
        );
    }
});