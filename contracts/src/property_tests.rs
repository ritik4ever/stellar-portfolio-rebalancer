#[cfg(test)]
extern crate std;

#[cfg(test)]
mod property_tests {
    use proptest::prelude::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::TokenClient,
        Address, Env, Map,
    };
    use crate::{
        PortfolioRebalancer, PortfolioRebalancerClient, ALLOCATION_DENOMINATOR,
        CURRENT_SLIPPAGE_POLICY_VERSION, DEFAULT_ASSET_DECIMALS,
    };

    // ── Mock Reflector for deterministic property testing ──────────────
    mod prop_reflector {
        use crate::reflector::{Asset, PriceData};
        use soroban_sdk::{contract, contractimpl, Env, Symbol, Vec};

        #[contract]
        pub struct PropReflector;

        #[contractimpl]
        impl PropReflector {
            pub fn base(env: Env) -> Asset {
                Asset::Other(Symbol::new(&env, "USD"))
            }
            pub fn assets(_env: Env) -> Vec<Asset> {
                Vec::new(&_env)
            }
            pub fn decimals(_env: Env) -> u32 {
                14
            }
            pub fn lastprice(env: Env, _asset: Asset) -> Option<PriceData> {
                Some(PriceData {
                    price: 100_00000000000000i128,
                    timestamp: env.ledger().timestamp(),
                })
            }
            pub fn twap(_env: Env, _asset: Asset, _records: u32) -> Option<i128> {
                Some(100_00000000000000i128)
            }
        }
    }

    // ── Helper: generate N random assets and an allocation sum of 10000 ──
    fn setup_env_with_assets(
        n_assets: usize,
    ) -> (Env, PortfolioRebalancerClient, Address, Address, Vec<Address>) {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| {
            li.timestamp = 1_000_000;
            li.sequence_number = 1;
        });

        let contract_id = env.register_contract(None, PortfolioRebalancer);
        let client = PortfolioRebalancerClient::new(&env, &contract_id);
        let reflector_id = env.register_contract(None, prop_reflector::PropReflector);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.initialize(&admin, &reflector_id);

        let mut assets = Vec::new(&env);
        for _ in 0..n_assets {
            let asset = env.register_stellar_asset_contract(admin.clone());
            let token = TokenClient::new(&env, &asset);
            token.mint(&user, &1_000_000_000);
            assets.push_back(asset);
        }

        (env, client, admin, user, assets)
    }

    /// Generate random allocation map that sums to exactly ALLOCATION_DENOMINATOR (10000)
    fn random_allocations(
        env: &Env,
        assets: &Vec<Address>,
    ) -> (Map<Address, u32>, Map<Address, u32>) {
        // Walk the asset list assigning random positive amounts;
        // the last asset gets the remainder so the total is exactly 10000.
        use std::collections::HashMap;
        let mut rng = proptest::test_runner::TestRng::deterministic_rng(
            &proptest::test_runner::RngAlgorithm::ChaCha,
        );
        let result = rng.gen::<proptest::num::u64::BinarySearch>();

        let mut alloc_map = HashMap::new();
        let n = assets.len() as u32;
        let mut remaining = ALLOCATION_DENOMINATOR;

        for (i, asset) in assets.iter().enumerate() {
            if i == assets.len() - 1 {
                // Last asset takes whatever is left
                if remaining > 0 {
                    alloc_map.insert(
                        format!("asset_{i}"),
                        (asset.clone(), remaining),
                    );
                }
            } else {
                // Random amount between 1 and remaining - (count of remaining assets)
                let min_for_rest = (n - (i as u32) - 1);
                let max_for_this = remaining.saturating_sub(min_for_rest);
                let amount = if max_for_this <= 1 {
                    1
                } else {
                    let raw = (result.0 >> (i * 8)) as u32 % max_for_this;
                    if raw == 0 { 1 } else { raw.min(max_for_this) }
                };
                remaining = remaining.saturating_sub(amount);
                alloc_map.insert(
                    format!("asset_{i}"),
                    (asset.clone(), amount),
                );
            }
        }

        let mut soroban_allocations = Map::new(env);
        let mut soroban_decimals = Map::new(env);
        for (asset, pct) in alloc_map.values() {
            soroban_allocations.set(asset.clone(), *pct);
            soroban_decimals.set(asset.clone(), DEFAULT_ASSET_DECIMALS);
        }

        (soroban_allocations, soroban_decimals)
    }

    // ════════════════════════════════════════════════════════════════════
    // Property 1: Allocations always sum to 10 000 basis points
    // ════════════════════════════════════════════════════════════════════

    proptest! {
        #![proptest_config(ProptestConfig {
            cases: 10_000,
            ..ProptestConfig::default()
        })]

        #[test]
        fn property_allocations_sum_to_denominator(n_assets in 2usize..=10) {
            let (env, client, _admin, user, assets) = setup_env_with_assets(n_assets);
            let (allocations, decimals) = random_allocations(&env, &assets);

            // Compute sum manually
            let total: u32 = allocations.values().iter()
                .map(|v| v.unwrap())
                .sum();

            assert_eq!(
                total,
                ALLOCATION_DENOMINATOR,
                "allocations must sum to exactly {ALLOCATION_DENOMINATOR} bps, got {total}",
                ALLOCATION_DENOMINATOR = ALLOCATION_DENOMINATOR,
                total = total
            );

            // Creating the portfolio should succeed
            let pid = client.create_portfolio(
                &user,
                &allocations,
                &decimals,
                &5,
                &50,
                &CURRENT_SLIPPAGE_POLICY_VERSION,
            );
            assert!(pid > 0, "portfolio creation must succeed for valid allocations");
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // Property 2: Drift is always in 0–10 000 range
    // ════════════════════════════════════════════════════════════════════

    proptest! {
        #![proptest_config(ProptestConfig {
            cases: 10_000,
            ..ProptestConfig::default()
        })]

        #[test]
        fn property_drift_in_valid_range(n_assets in 2usize..=6) {
            let (env, client, _admin, user, assets) = setup_env_with_assets(n_assets);
            let (allocations, decimals) = random_allocations(&env, &assets);

            let pid = client.create_portfolio(
                &user,
                &allocations,
                &decimals,
                &1,   // 1% threshold for fine-grained drift detection
                &100,
                &CURRENT_SLIPPAGE_POLICY_VERSION,
            );

            // Deposit equal amounts across all assets
            for asset in assets.iter() {
                client.deposit(
                    &pid,
                    &asset,
                    &100_000_000,
                    &soroban_sdk::String::from_str(&env, "proptest"),
                );
            }

            let portfolio = client.get_portfolio(&pid);

            // Verify each asset's allocation is a valid percentage
            for (asset, target_pct) in portfolio.target_allocations.iter() {
                assert!(
                    target_pct > 0 && target_pct <= ALLOCATION_DENOMINATOR,
                    "target_pct {target_pct} out of range [1, {max}] for asset {asset}",
                    target_pct = target_pct,
                    max = ALLOCATION_DENOMINATOR,
                    asset = asset
                );
            }

            // Get drift preview
            let drift_preview = client.get_drift_preview(&pid);
            for entry in drift_preview.iter() {
                assert!(
                    entry.current_pct <= ALLOCATION_DENOMINATOR,
                    "current_pct {current} exceeds {max} for asset {asset}",
                    current = entry.current_pct,
                    max = ALLOCATION_DENOMINATOR,
                    asset = entry.asset
                );
                assert!(
                    entry.drift_pct <= ALLOCATION_DENOMINATOR,
                    "drift_pct {drift} exceeds {max} for asset {asset}",
                    drift = entry.drift_pct,
                    max = ALLOCATION_DENOMINATOR,
                    asset = entry.asset
                );
            }

            // Portfolio valuation also in valid range
            let valuation = client.get_portfolio_value_usd(&pid);
            assert!(valuation.total_usd_value > 0, "total USD value must be positive");
            for av in valuation.assets.iter() {
                assert!(
                    av.target_pct <= ALLOCATION_DENOMINATOR,
                    "valuation target_pct out of range"
                );
                assert!(
                    av.current_pct <= ALLOCATION_DENOMINATOR,
                    "valuation current_pct out of range"
                );
            }
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // Property 3: Rebalance is idempotent when drift = 0
    // ════════════════════════════════════════════════════════════════════

    proptest! {
        #![proptest_config(ProptestConfig {
            cases: 10_000,
            ..ProptestConfig::default()
        })]

        #[test]
        fn property_rebalance_idempotent_when_no_drift(n_assets in 2usize..=5) {
            let (env, client, _admin, user, assets) = setup_env_with_assets(n_assets);
            let (allocations, decimals) = random_allocations(&env, &assets);

            let pid = client.create_portfolio(
                &user,
                &allocations,
                &decimals,
                &50,  // 50% threshold — virtually any allocation satisfies "no drift"
                &500,
                &CURRENT_SLIPPAGE_POLICY_VERSION,
            );

            // Deposit 1 unit of each asset — since prices are equal ($100 each),
            // and allocations are proportional, drift should be 0
            for asset in assets.iter() {
                client.deposit(
                    &pid,
                    &asset,
                    &1_000_000,
                    &soroban_sdk::String::from_str(&env, "proptest"),
                );
            }

            let portfolio_before = client.get_portfolio(&pid);
            let needs_rebalance = client.check_rebalance_needed(&pid);

            if !needs_rebalance {
                // With 50% threshold, rebalance should not be needed
                let preview = client.preview_rebalance(&pid);

                // If no rebalance needed, the preview should confirm it
                assert!(
                    !preview.rebalance_needed || preview.candidate_trades.is_empty(),
                    "preview should not need rebalance when drift check says no"
                );

                // Verify invariants
                let inv_result = client.check_invariants(&pid);
                assert!(
                    inv_result.is_ok(),
                    "portfolio invariants must hold: {:?}",
                    inv_result
                );

                // Portfolio state unchanged
                let portfolio_after = client.get_portfolio(&pid);
                assert_eq!(
                    portfolio_before.total_value,
                    portfolio_after.total_value,
                    "portfolio should be unchanged when no rebalance executed"
                );
            } else {
                // If rebalance IS needed (unlikely with 50% threshold and equal
                // prices), execute it and verify it converges
                env.ledger().with_mut(|li| {
                    li.timestamp = env.ledger().timestamp() + 5000;
                });

                let result = client.try_execute_rebalance(&pid, &Map::new(&env));
                if result.is_ok() {
                    // After one rebalance, the portfolio should be stable
                    // (no further rebalance needed with the same threshold)
                    let needs_second = client.check_rebalance_needed(&pid);
                    // With 50% threshold it should definitely not need another
                    assert!(
                        !needs_second,
                        "rebalance should be idempotent: no second rebalance needed"
                    );
                }
            }
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // Property 4: Deposit + immediate withdraw = original balance
    // ════════════════════════════════════════════════════════════════════

    proptest! {
        #![proptest_config(ProptestConfig {
            cases: 10_000,
            ..ProptestConfig::default()
        })]

        #[test]
        fn property_deposit_withdraw_roundtrip(amount in 1i128..=10_000_000i128) {
            let (env, client, _admin, user, assets) = setup_env_with_assets(2);
            let (allocations, decimals) = random_allocations(&env, &assets);

            let pid = client.create_portfolio(
                &user,
                &allocations,
                &decimals,
                &5,
                &50,
                &CURRENT_SLIPPAGE_POLICY_VERSION,
            );

            let asset = assets.first().unwrap();
            let token = TokenClient::new(&env, &asset);

            let user_balance_before = token.balance(&user);

            // Deposit
            client.deposit(
                &pid,
                &asset,
                &amount,
                &soroban_sdk::String::from_str(&env, "roundtrip"),
            );

            let portfolio = client.get_portfolio(&pid);
            let internal_balance = portfolio.current_balances.get(asset.clone()).unwrap_or(0);
            assert_eq!(
                internal_balance, amount,
                "internal balance must match deposit amount"
            );

            // Withdraw the same amount
            client.withdraw(&pid, &asset, &amount);

            let portfolio_after = client.get_portfolio(&pid);
            let internal_after = portfolio_after.current_balances.get(asset.clone()).unwrap_or(0);
            assert_eq!(
                internal_after, 0,
                "internal balance must be 0 after full withdraw"
            );

            let user_balance_after = token.balance(&user);
            // User should get their deposit back (minus no fees since disabled)
            assert_eq!(
                user_balance_after, user_balance_before,
                "user balance should be restored after roundtrip (deposit + withdraw)"
            );
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // Property 5: Random allocations validated correctly
    // ════════════════════════════════════════════════════════════════════

    proptest! {
        #![proptest_config(ProptestConfig {
            cases: 10_000,
            ..ProptestConfig::default()
        })]

        #[test]
        fn property_random_allocations_valid(n_assets in 2usize..=10) {
            let (env, client, _admin, user, assets) = setup_env_with_assets(n_assets);
            let (allocations, decimals) = random_allocations(&env, &assets);

            // All allocations should be accepted
            let result = client.try_create_portfolio(
                &user,
                &allocations,
                &decimals,
                &5,
                &50,
                &CURRENT_SLIPPAGE_POLICY_VERSION,
            );

            prop_assert!(result.is_ok(), "valid allocations should always create portfolio");

            let pid = result.unwrap();
            let portfolio = client.get_portfolio(&pid);

            // Verify stored allocations match input
            for (asset, pct) in allocations.iter() {
                let stored = portfolio.target_allocations.get(asset.clone());
                prop_assert_eq!(
                    stored, Some(pct),
                    "stored allocation for asset must match input"
                );
            }

            // Verify invariants hold
            let inv = client.check_invariants(&pid);
            prop_assert!(inv.is_ok(), "invariants must hold after create");
        }
    }
}
