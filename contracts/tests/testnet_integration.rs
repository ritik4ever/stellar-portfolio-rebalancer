#![cfg(feature = "integration")]

use portfolio_rebalancer::{Error, PauseReason, PortfolioRebalancer, PortfolioRebalancerClient, CURRENT_SLIPPAGE_POLICY_VERSION, DEFAULT_ASSET_DECIMALS};
use soroban_sdk::{testutils::{Address as _, Ledger}, token::TokenClient, Address, Env, Map, String};

fn create_token_and_mint(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
    let token_id = env.register_stellar_asset_contract(admin.clone());
    let token = TokenClient::new(env, &token_id); token.mint(to, &amount); token_id
}

mod testnet_reflector {
    use portfolio_rebalancer::{Asset, PriceData};
    use soroban_sdk::{contract, contractimpl, Env, Symbol, Vec};
    #[contract] pub struct TestnetOracle;
    #[contractimpl] impl TestnetOracle {
        pub fn base(env: Env) -> Asset { Asset::Other(Symbol::new(&env, "USD")) }
        pub fn assets(_env: Env) -> Vec<Asset> { Vec::new(&_env) }
        pub fn decimals(_env: Env) -> u32 { 14 }
        pub fn lastprice(env: Env, _asset: Asset) -> Option<PriceData> {
            Some(PriceData { price: 100_00000000000000i128, timestamp: env.ledger().timestamp() })
        }
        pub fn twap(_env: Env, _asset: Asset, _records: u32) -> Option<i128> { Some(100_00000000000000i128) }
    }
}

#[test] fn testnet_full_lifecycle() {
    let env = Env::default(); env.mock_all_auths(); env.ledger().with_mut(|li| { li.timestamp = 1_000_000; li.sequence_number = 1; });
    let cid = env.register_contract(None, PortfolioRebalancer); let client = PortfolioRebalancerClient::new(&env, &cid);
    let rid = env.register_contract(None, testnet_reflector::TestnetOracle); let admin = Address::generate(&env); let user = Address::generate(&env);
    client.initialize(&admin, &rid);
    let a = create_token_and_mint(&env, &admin, &user, 1_000_000_000); let b = create_token_and_mint(&env, &admin, &user, 1_000_000_000);
    let mut alloc = Map::new(&env); alloc.set(a.clone(), 5000); alloc.set(b.clone(), 5000);
    let mut dec = Map::new(&env); dec.set(a.clone(), DEFAULT_ASSET_DECIMALS); dec.set(b.clone(), DEFAULT_ASSET_DECIMALS);
    let pid = client.create_portfolio(&user, &alloc, &dec, &5, &50, &CURRENT_SLIPPAGE_POLICY_VERSION); assert_eq!(pid, 1);
    client.deposit(&pid, &a, &500_000_000, &String::from_str(&env, "")); client.deposit(&pid, &b, &500_000_000, &String::from_str(&env, ""));
    let val = client.get_portfolio_value_usd(&pid); assert!(val.total_usd_value > 0);
    let p = client.get_portfolio(&pid); let ta = TokenClient::new(&env, &a); let tb = TokenClient::new(&env, &b);
    assert_eq!(ta.balance(&cid), p.current_balances.get(a).unwrap()); assert_eq!(tb.balance(&cid), p.current_balances.get(b).unwrap());
}

#[test] fn testnet_emergency_stop() {
    let env = Env::default(); env.mock_all_auths(); env.ledger().with_mut(|li| { li.timestamp = 1_000_000; });
    let cid = env.register_contract(None, PortfolioRebalancer); let client = PortfolioRebalancerClient::new(&env, &cid);
    let rid = env.register_contract(None, testnet_reflector::TestnetOracle); let admin = Address::generate(&env); let user = Address::generate(&env);
    client.initialize(&admin, &rid);
    let asset = create_token_and_mint(&env, &admin, &user, 100_000_000);
    let mut alloc = Map::new(&env); alloc.set(asset.clone(), 10000); let mut dec = Map::new(&env); dec.set(asset.clone(), DEFAULT_ASSET_DECIMALS);
    let pid = client.create_portfolio(&user, &alloc, &dec, &5, &50, &CURRENT_SLIPPAGE_POLICY_VERSION);
    client.deposit(&pid, &asset, &50_000_000, &String::from_str(&env, ""));
    client.set_emergency_stop(&true); let r = client.try_deposit(&pid, &asset, &10_000_000, &String::from_str(&env, "")); assert_eq!(r, Err(Ok(Error::EmergencyStop)));
    client.set_emergency_stop(&false); client.deposit(&pid, &asset, &10_000_000, &String::from_str(&env, ""));
}
