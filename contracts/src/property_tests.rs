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

    // ── Helper ─────────────────────────────────────────────────────────
    fn setup_env(n_assets: usize) -> (Env, PortfolioRebalancerClient, Address, Vec<Address>) {
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

        (env, client, user, assets)
    }

    /// Normalize a vector of raw values to sum to exactly ALLOCATION_DENOMINATOR.
    /// Uses proportional scaling — preserves the relative weights of inputs.
    fn normalize_to_bps(raw: &[u32]) -> Vec<u32> {
        let sum: u32 = raw.iter().sum();
        if sum == 0 || sum == ALLOCATION_DENOMINATOR {
            return raw.to_vec();
        }
        // Scale each value proportionally
        let mut result: Vec<u32> = raw
            .iter()
            .map(|&v| ((v as u64 * ALLOCATION_DENOMINATOR as u64) / sum as u64) as u32)
            .collect();
        // Fix rounding so total is exactly ALLOCATION_DENOMINATOR
        let new_sum: u32 = result.iter().sum();
        let diff = ALLOCATION_DENOMINATOR as i32 - new_sum as i32;
        if diff != 0 && !result.is_empty() {
            let idx = (diff.abs() as usize) % result.len();
            result[idx] = (result[idx] as i32 + diff) as u32;
        }
        result
    }

    // ════════════════════════════════════════════════════════════════════
    // Property 1: All valid allocations (sum = 10000 bps) are accepted
    // ════════════════════════════════════════════════════════════════════

    proptest! {
        #![proptest_config(ProptestConfig {
            cases: 10_000,
            ..ProptestConfig::default()
        })]

        #[test]
        fn property_valid_allocations_always_accepted(
            raw_bps in proptest::collection::vec(1u32..10000, 2..=10)
        ) {
            let bps = normalize_to_bps(&raw_bps);
            let n = bps.len();
            let (env, client, user, assets) = setup_env(n);

            let sum: u32 = bps.iter().sum();
            prop_assert_eq!(sum, ALLOCATION_DENOMINATOR,
                "normalized bps must sum to {ALLOCATION_DENOMINATOR}");

            let mut allocations = Map::new(&env);
            let mut decimals = Map::new(&env);
            for (i, &pct) in bps.iter().enumerate() {
                if pct > 0 {
                    allocations.set(assets[i].clone(), pct);
                    decimals.set(assets[i].clone(), DEFAULT_ASSET_DECIMALS);
                }
            }

            // All valid allocations should create successfully
            let result = client.try_create_portfolio(
                &user,
                &allocations,
                &decimals,
                &5,
                &50,
                &CURRENT_SLIPPAGE_POLICY_VERSION,
            );

            prop_assert!(result.is_ok(),
                "valid allocation (sum={}) must create portfolio", sum);

            let pid = result.unwrap();
            let portfolio = client.get_portfolio(&pid);

            // Verify stored allocations match input exactly
            for (i, &pct) in bps.iter().enumerate() {
                if pct > 0 {
                    let stored = portfolio.target_allocations.get(assets[i].clone());
                    prop_assert_eq!(stored, Some(pct),
                        "stored allocation must match input");
                }
            }
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // Property 2: Invalid allocations (sum ≠ 10000) are rejected
    // ════════════════════════════════════════════════════════════════════

    proptest! {
        #![proptest_config(ProptestConfig {
            cases: 10_000,
            ..ProptestConfig::default()
        })]

        #[test]
        fn property_invalid_allocations_rejected(
            raw_bps in proptest::collection::vec(1u32..1000, 2..=5)
        ) {
            // Don't normalize — let the sum be whatever it is (likely ≠ 10000)
            let sum: u32 = raw_bps.iter().sum();
            // Skip if sum accidentally equals 10000
            prop_assume!(sum != ALLOCATION_DENOMINATOR);

            let (env, client, user, assets) = setup_env(raw_bps.len());

            let mut allocations = Map::new(&env);
            let mut decimals = Map::new(&env);
            for (i, &pct) in raw_bps.iter().enumerate() {
                allocations.set(assets[i].clone(), pct);
                decimals.set(assets[i].clone(), DEFAULT_ASSET_DECIMALS);
            }

            let result = client.try_create_portfolio(
                &user,
                &allocations,
                &decimals,
                &5,
                &50,
                &CURRENT_SLIPPAGE_POLICY_VERSION,
            );

            // Invalid sums should be rejected
            prop_assert!(result.is_err(),
                "allocation sum {} must be rejected (expected InvalidAllocation)", sum);
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // Property 3: Drift and current_pct always in [0, 10000] range
    // ════════════════════════════════════════════════════════════════════

    proptest! {
        #![proptest_config(ProptestConfig {
            cases: 10_000,
            ..ProptestConfig::default()
        })]

        #[test]
        fn property_drift_and_pct_in_range(
            raw_bps in proptest::collection::vec(1u32..10000, 2..=6)
        ) {
            let bps = normalize_to_bps(&raw_bps);
            let n = bps.len();
            let (env, client, user, assets) = setup_env(n);

            let mut allocations = Map::new(&env);
            let mut decimals = Map::new(&env);
            for (i, &pct) in bps.iter().enumerate() {
                if pct > 0 {
                    allocations.set(assets[i].clone(), pct);
                    decimals.set(assets[i].clone(), DEFAULT_ASSET_DECIMALS);
                }
            }

            let pid = client.create_portfolio(
                &user, &allocations, &decimals, &1, &100,
                &CURRENT_SLIPPAGE_POLICY_VERSION,
            );

            // Deposit equal amounts — prices equal so no drift
            for asset in assets.iter().take(n) {
                client.deposit(
                    &pid, &asset, &100_000_000,
                    &soroban_sdk::String::from_str(&env, "p"),
                );
            }

            // Get valuation — all fields must be in range
            let valuation = client.get_portfolio_value_usd(&pid);
            prop_assert!(valuation.total_usd_value > 0);

            for av in valuation.assets.iter() {
                prop_assert!(av.target_pct <= ALLOCATION_DENOMINATOR,
                    "target_pct {} exceeds max", av.target_pct);
                prop_assert!(av.current_pct <= ALLOCATION_DENOMINATOR,
                    "current_pct {} exceeds max", av.current_pct);
                // drift is i32, can technically be negative
                let abs_drift = av.drift.abs() as u32;
                prop_assert!(abs_drift <= ALLOCATION_DENOMINATOR,
                    "abs(drift) {} exceeds max", abs_drift);
            }

            // Invariants must hold
            let inv = client.check_invariants(&pid);
            prop_assert!(inv.is_ok(), "invariants must hold: {:?}", inv);
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
        fn property_deposit_withdraw_roundtrip(amount in 1i128..=1_000_000i128) {
            let (env, client, user, assets) = setup_env(2);
            let asset = assets.first().unwrap();
            let token = TokenClient::new(&env, &asset);

            let mut allocations = Map::new(&env);
            allocations.set(asset.clone(), ALLOCATION_DENOMINATOR);
            let mut decimals = Map::new(&env);
            decimals.set(asset.clone(), DEFAULT_ASSET_DECIMALS);

            let pid = client.create_portfolio(
                &user, &allocations, &decimals,
                &5, &50, &CURRENT_SLIPPAGE_POLICY_VERSION,
            );

            let user_before = token.balance(&user);

            // Deposit
            client.deposit(&pid, &asset, &amount,
                &soroban_sdk::String::from_str(&env, "rt"));

            let portfolio = client.get_portfolio(&pid);
            let internal = portfolio.current_balances.get(asset.clone()).unwrap_or(0);
            prop_assert_eq!(internal, amount, "internal balance must match deposit");

            // Withdraw same amount
            client.withdraw(&pid, &asset, &amount);

            let portfolio_after = client.get_portfolio(&pid);
            let internal_after = portfolio_after.current_balances.get(asset.clone()).unwrap_or(0);
            prop_assert_eq!(internal_after, 0, "balance must be 0 after full withdraw");

            let user_after = token.balance(&user);
            prop_assert_eq!(user_after, user_before,
                "user balance must be restored after roundtrip");
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // Property 5: Rebalance idempotency when no drift
    // ════════════════════════════════════════════════════════════════════

    proptest! {
        #![proptest_config(ProptestConfig {
            cases: 10_000,
            ..ProptestConfig::default()
        })]

        #[test]
        fn property_rebalance_idempotent(
            raw_bps in proptest::collection::vec(1u32..10000, 2..=4)
        ) {
            let bps = normalize_to_bps(&raw_bps);
            let n = bps.len();
            let (env, client, user, assets) = setup_env(n);

            let mut allocations = Map::new(&env);
            let mut decimals = Map::new(&env);
            for (i, &pct) in bps.iter().enumerate() {
                if pct > 0 {
                    allocations.set(assets[i].clone(), pct);
                    decimals.set(assets[i].clone(), DEFAULT_ASSET_DECIMALS);
                }
            }

            let pid = client.create_portfolio(
                &user, &allocations, &decimals,
                &50,  // wide threshold — rebalance not needed with equal prices
                &500, &CURRENT_SLIPPAGE_POLICY_VERSION,
            );

            for asset in assets.iter().take(n) {
                client.deposit(&pid, &asset, &1_000_000,
                    &soroban_sdk::String::from_str(&env, "id"));
            }

            let needs = client.check_rebalance_needed(&pid);
            if !needs {
                // With 50% threshold and equal prices, rebalance should not be needed
                let preview = client.preview_rebalance(&pid);
                prop_assert!(
                    !preview.rebalance_needed || preview.candidate_trades.is_empty(),
                    "when check_rebalance_needed=false, preview should agree"
                );

                // Verify invariants hold
                let inv = client.check_invariants(&pid);
                prop_assert!(inv.is_ok(), "invariants must hold: {:?}", inv);
            } else {
                // If needed, execute and verify it converges in one pass
                env.ledger().with_mut(|li| {
                    li.timestamp += 5000;
                });
                let result = client.try_execute_rebalance(&pid, &Map::new(&env));
                if result.is_ok() {
                    let needs_after = client.check_rebalance_needed(&pid);
                    prop_assert!(!needs_after,
                        "after one rebalance, should not need another");
                }
            }
        }
    }
}
