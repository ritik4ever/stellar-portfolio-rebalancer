#[cfg(test)]
extern crate std;

#[cfg(test)]
mod property_tests {
    use proptest::prelude::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::TokenClient, Address, Env, Map,
    };
    use crate::{PortfolioRebalancer, PortfolioRebalancerClient, ALLOCATION_DENOMINATOR, CURRENT_SLIPPAGE_POLICY_VERSION, DEFAULT_ASSET_DECIMALS};

    mod prop_reflector {
        use crate::reflector::{Asset, PriceData};
        use soroban_sdk::{contract, contractimpl, Env, Symbol, Vec};
        #[contract] pub struct PropReflector;
        #[contractimpl] impl PropReflector {
            pub fn base(env: Env) -> Asset { Asset::Other(Symbol::new(&env, "USD")) }
            pub fn assets(_env: Env) -> Vec<Asset> { Vec::new(&_env) }
            pub fn decimals(_env: Env) -> u32 { 14 }
            pub fn lastprice(env: Env, _asset: Asset) -> Option<PriceData> {
                Some(PriceData { price: 100_00000000000000i128, timestamp: env.ledger().timestamp() })
            }
            pub fn twap(_env: Env, _asset: Asset, _records: u32) -> Option<i128> { Some(100_00000000000000i128) }
        }
    }

    fn setup_env(n: usize) -> (Env, PortfolioRebalancerClient, Address, Vec<Address>) {
        let env = Env::default(); env.mock_all_auths(); env.ledger().with_mut(|li| { li.timestamp = 1_000_000; li.sequence_number = 1; });
        let cid = env.register_contract(None, PortfolioRebalancer); let client = PortfolioRebalancerClient::new(&env, &cid);
        let rid = env.register_contract(None, prop_reflector::PropReflector); let admin = Address::generate(&env); let user = Address::generate(&env);
        client.initialize(&admin, &rid);
        let mut assets = Vec::new(&env);
        for _ in 0..n { let a = env.register_stellar_asset_contract(admin.clone()); TokenClient::new(&env, &a).mint(&user, &1_000_000_000); assets.push_back(a); }
        (env, client, user, assets)
    }

    fn normalize_to_bps(raw: &[u32]) -> Vec<u32> {
        let sum: u32 = raw.iter().sum(); if sum == 0 || sum == ALLOCATION_DENOMINATOR { return raw.to_vec(); }
        let mut r: Vec<u32> = raw.iter().map(|&v| ((v as u64 * ALLOCATION_DENOMINATOR as u64) / sum as u64) as u32).collect();
        let ns: u32 = r.iter().sum(); let d = ALLOCATION_DENOMINATOR as i32 - ns as i32;
        if d != 0 && !r.is_empty() { r[(d.abs() as usize) % r.len()] = (r[(d.abs() as usize) % r.len()] as i32 + d) as u32; }
        r
    }

    proptest! {
        #![proptest_config(ProptestConfig { cases: 10_000, ..ProptestConfig::default() })]
        #[test]
        fn property_valid_allocations_accepted(raw in proptest::collection::vec(1u32..10000, 2..=10)) {
            let bps = normalize_to_bps(&raw); let n = bps.len(); let (env, client, user, assets) = setup_env(n);
            let sum: u32 = bps.iter().sum(); prop_assert_eq!(sum, ALLOCATION_DENOMINATOR);
            let mut alloc = Map::new(&env); let mut dec = Map::new(&env);
            for (i, &p) in bps.iter().enumerate() { if p > 0 { alloc.set(assets[i].clone(), p); dec.set(assets[i].clone(), DEFAULT_ASSET_DECIMALS); } }
            let r = client.try_create_portfolio(&user, &alloc, &dec, &5, &50, &CURRENT_SLIPPAGE_POLICY_VERSION);
            prop_assert!(r.is_ok()); let pid = r.unwrap(); let p = client.get_portfolio(&pid);
            for (i, &pct) in bps.iter().enumerate() { if pct > 0 { prop_assert_eq!(p.target_allocations.get(assets[i].clone()), Some(pct)); } }
        }

        #[test]
        fn property_invalid_allocations_rejected(raw in proptest::collection::vec(1u32..1000, 2..=5)) {
            let sum: u32 = raw.iter().sum(); prop_assume!(sum != ALLOCATION_DENOMINATOR);
            let (env, client, user, assets) = setup_env(raw.len());
            let mut alloc = Map::new(&env); let mut dec = Map::new(&env);
            for (i, &p) in raw.iter().enumerate() { alloc.set(assets[i].clone(), p); dec.set(assets[i].clone(), DEFAULT_ASSET_DECIMALS); }
            prop_assert!(client.try_create_portfolio(&user, &alloc, &dec, &5, &50, &CURRENT_SLIPPAGE_POLICY_VERSION).is_err());
        }

        #[test]
        fn property_deposit_withdraw_roundtrip(amt in 1i128..=1_000_000i128) {
            let (env, client, user, assets) = setup_env(2);
            let asset = assets.first().unwrap(); let token = TokenClient::new(&env, &asset);
            let mut alloc = Map::new(&env); alloc.set(asset.clone(), ALLOCATION_DENOMINATOR);
            let mut dec = Map::new(&env); dec.set(asset.clone(), DEFAULT_ASSET_DECIMALS);
            let pid = client.create_portfolio(&user, &alloc, &dec, &5, &50, &CURRENT_SLIPPAGE_POLICY_VERSION);
            let ub = token.balance(&user);
            client.deposit(&pid, &asset, &amt, &soroban_sdk::String::from_str(&env, "rt"));
            let p = client.get_portfolio(&pid); prop_assert_eq!(p.current_balances.get(asset.clone()).unwrap_or(0), amt);
            client.withdraw(&pid, &asset, &amt);
            let pa = client.get_portfolio(&pid); prop_assert_eq!(pa.current_balances.get(asset.clone()).unwrap_or(0), 0);
            prop_assert_eq!(token.balance(&user), ub);
        }

        #[test]
        fn property_drift_in_range(raw in proptest::collection::vec(1u32..10000, 2..=6)) {
            let bps = normalize_to_bps(&raw); let (env, client, user, assets) = setup_env(bps.len());
            let mut alloc = Map::new(&env); let mut dec = Map::new(&env);
            for (i, &p) in bps.iter().enumerate() { if p > 0 { alloc.set(assets[i].clone(), p); dec.set(assets[i].clone(), DEFAULT_ASSET_DECIMALS); } }
            let pid = client.create_portfolio(&user, &alloc, &dec, &1, &100, &CURRENT_SLIPPAGE_POLICY_VERSION);
            for a in assets.iter() { client.deposit(&pid, &a, &100_000_000, &soroban_sdk::String::from_str(&env, "p")); }
            let val = client.get_portfolio_value_usd(&pid); prop_assert!(val.total_usd_value > 0);
            for av in val.assets.iter() {
                prop_assert!(av.target_pct <= ALLOCATION_DENOMINATOR);
                prop_assert!(av.current_pct <= ALLOCATION_DENOMINATOR);
                prop_assert!((av.drift.abs() as u32) <= ALLOCATION_DENOMINATOR);
            }
            prop_assert!(client.check_invariants(&pid).is_ok());
        }

        #[test]
        fn property_rebalance_idempotent(raw in proptest::collection::vec(1u32..10000, 2..=4)) {
            let bps = normalize_to_bps(&raw); let (env, client, user, assets) = setup_env(bps.len());
            let mut alloc = Map::new(&env); let mut dec = Map::new(&env);
            for (i, &p) in bps.iter().enumerate() { if p > 0 { alloc.set(assets[i].clone(), p); dec.set(assets[i].clone(), DEFAULT_ASSET_DECIMALS); } }
            let pid = client.create_portfolio(&user, &alloc, &dec, &50, &500, &CURRENT_SLIPPAGE_POLICY_VERSION);
            for a in assets.iter() { client.deposit(&pid, &a, &1_000_000, &soroban_sdk::String::from_str(&env, "id")); }
            if !client.check_rebalance_needed(&pid) {
                let prev = client.preview_rebalance(&pid);
                prop_assert!(!prev.rebalance_needed || prev.candidate_trades.is_empty());
                prop_assert!(client.check_invariants(&pid).is_ok());
            } else {
                env.ledger().with_mut(|li| { li.timestamp += 5000; });
                if client.try_execute_rebalance(&pid, &Map::new(&env)).is_ok() {
                    prop_assert!(!client.check_rebalance_needed(&pid));
                }
            }
        }
    }
}
