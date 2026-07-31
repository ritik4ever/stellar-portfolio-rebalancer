#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, Map};

use portfolio_rebalancer::portfolio::validate_allocations;
use portfolio_rebalancer::types::{
    MAX_PORTFOLIO_ASSETS, MAX_REBALANCE_THRESHOLD, MAX_SLIPPAGE_TOLERANCE_BPS,
    MIN_REBALANCE_THRESHOLD, MIN_SLIPPAGE_TOLERANCE_BPS,
};

fuzz_target!(|data: &[u8]| {
    if data.is_empty() {
        return;
    }

    let env = Env::default();

    // Path 1: completely arbitrary allocation percentages — must never panic
    {
        let mut allocs: Map<Address, u32> = Map::new(&env);
        for chunk in data.chunks(2).take(MAX_PORTFOLIO_ASSETS as usize + 2) {
            if chunk.len() < 2 {
                break;
            }
            allocs.set(Address::generate(&env), chunk[1] as u32);
        }
        let _ = validate_allocations(&allocs);
    }

    // Path 2: single asset — only valid when pct == 100
    {
        let pct = data[0] as u32;
        let mut allocs: Map<Address, u32> = Map::new(&env);
        allocs.set(Address::generate(&env), pct);
        let result = validate_allocations(&allocs);
        assert_eq!(
            result,
            pct == 100,
            "single asset: expected {} for pct={pct}",
            pct == 100
        );
    }

    // Path 3: boundary constants must always be in the right order
    {
        assert!(MIN_REBALANCE_THRESHOLD <= MAX_REBALANCE_THRESHOLD);
        assert!(MIN_SLIPPAGE_TOLERANCE_BPS <= MAX_SLIPPAGE_TOLERANCE_BPS);
        assert!(MAX_PORTFOLIO_ASSETS >= 1);
    }
});
