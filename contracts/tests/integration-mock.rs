#![cfg(feature = "integration")]

use portfolio_rebalancer::{
    AssetValuation, Error, PauseReason, PortfolioRebalancer, PortfolioRebalancerClient,
    ALLOCATION_DENOMINATOR, CURRENT_SLIPPAGE_POLICY_VERSION, DEFAULT_ASSET_DECIMALS,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map, String, Vec,
};

fn create_token_and_mint(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
    let token_id = env.register_stellar_asset_contract(admin.clone());
    StellarAssetClient::new(env, &token_id).mint(to, &amount);
    token_id
}

// ── Mock Reflector simulating live Reflector oracle on testnet ──────────

mod mock_reflector {
    use portfolio_rebalancer::{Asset, PriceData};
    use soroban_sdk::{contract, contractimpl, Env, Symbol, Vec};

    #[contract]
    pub struct TestnetReflector;

    #[contractimpl]
    impl TestnetReflector {
        pub fn base(env: Env) -> Asset {
            Asset::Other(Symbol::new(&env, "USD"))
        }

        pub fn assets(env: Env) -> Vec<Asset> {
            Vec::new(&env)
        }

        pub fn decimals(_env: Env) -> u32 {
            14
        }

        pub fn lastprice(env: Env, _asset: Asset) -> Option<PriceData> {
            Some(PriceData {
                price: 50_00000000000000i128,
                timestamp: env.ledger().timestamp(),
            })
        }

        pub fn twap(_env: Env, _asset: Asset, _records: u32) -> Option<i128> {
            Some(50_00000000000000i128)
        }
    }
}

// ── Full rebalance flow ────────────────────────────────────────────────

#[test]
fn integration_full_rebalance_flow() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| {
        li.timestamp = 1_000_000;
        li.sequence_number = 1;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, mock_reflector::TestnetReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin, &reflector_id);

    let asset_a = create_token_and_mint(&env, &admin, &user, 300_000_000);
    let asset_b = create_token_and_mint(&env, &admin, &user, 200_000_000);

    let mut allocations = Map::new(&env);
    allocations.set(asset_a.clone(), 5000);
    allocations.set(asset_b.clone(), 5000);

    let mut asset_decimals = Map::new(&env);
    asset_decimals.set(asset_a.clone(), DEFAULT_ASSET_DECIMALS);
    asset_decimals.set(asset_b.clone(), DEFAULT_ASSET_DECIMALS);

    let pid = client.create_portfolio(
        &user,
        &allocations,
        &asset_decimals,
        &5,
        &50,
        &CURRENT_SLIPPAGE_POLICY_VERSION,
    );
    assert_eq!(pid, 1);

    client.deposit(
        &pid,
        &asset_a,
        &200_000_000,
        &String::from_str(&env, "initial"),
    );
    client.deposit(
        &pid,
        &asset_b,
        &100_000_000,
        &String::from_str(&env, "initial"),
    );

    assert!(client.check_rebalance_needed(&pid));

    let preview = client.preview_rebalance(&pid);
    assert!(preview.rebalance_needed);
    assert!(preview.total_value > 0);

    env.ledger().with_mut(|li| {
        li.timestamp = 1_000_000 + 5000;
    });

    let actual_balances = Map::new(&env);
    client.execute_rebalance(&pid, &actual_balances);

    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.last_rebalance, 1_000_000 + 5000);

    let valuation = client.get_portfolio_value_usd(&pid);
    assert!(valuation.total_usd_value > 0);
    assert_eq!(valuation.assets.len(), 2);

    // Verify on-chain token balances match internal post-rebalance balances
    let token_a = TokenClient::new(&env, &asset_a);
    let token_b = TokenClient::new(&env, &asset_b);
    let contract_internal_a = portfolio.current_balances.get(asset_a).unwrap();
    let contract_internal_b = portfolio.current_balances.get(asset_b).unwrap();
    assert_eq!(token_a.balance(&contract_id), contract_internal_a);
    assert_eq!(token_b.balance(&contract_id), contract_internal_b);
}

// ── Basis points allocation validation ─────────────────────────────────

#[test]
fn integration_basis_points_fractional_allocations() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, mock_reflector::TestnetReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin, &reflector_id);

    let a1 = Address::generate(&env);
    let a2 = Address::generate(&env);
    let a3 = Address::generate(&env);

    let mut allocations = Map::new(&env);
    allocations.set(a1.clone(), 3333);
    allocations.set(a2.clone(), 3333);
    allocations.set(a3.clone(), 3334);

    let mut asset_decimals = Map::new(&env);
    asset_decimals.set(a1.clone(), DEFAULT_ASSET_DECIMALS);
    asset_decimals.set(a2.clone(), DEFAULT_ASSET_DECIMALS);
    asset_decimals.set(a3.clone(), DEFAULT_ASSET_DECIMALS);

    let pid = client.create_portfolio(
        &user,
        &allocations,
        &asset_decimals,
        &5,
        &50,
        &CURRENT_SLIPPAGE_POLICY_VERSION,
    );
    assert!(pid > 0);

    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.target_allocations.get(a1).unwrap(), 3333);
    assert_eq!(portfolio.target_allocations.get(a2).unwrap(), 3333);
    assert_eq!(portfolio.target_allocations.get(a3).unwrap(), 3334);
}

// ── Allocation sum validation at rebalance time (#861) ─────────────────

#[test]
fn integration_rebalance_rejects_corrupted_allocations() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| {
        li.timestamp = 10_000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, mock_reflector::TestnetReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin, &reflector_id);

    let asset = Address::generate(&env);
    let mut allocations = Map::new(&env);
    allocations.set(asset.clone(), 10000);

    let mut asset_decimals = Map::new(&env);
    asset_decimals.set(asset.clone(), DEFAULT_ASSET_DECIMALS);

    let pid = client.create_portfolio(
        &user,
        &allocations,
        &asset_decimals,
        &5,
        &50,
        &CURRENT_SLIPPAGE_POLICY_VERSION,
    );

    use portfolio_rebalancer::{DataKey, Portfolio};
    env.as_contract(&contract_id, || {
        let mut portfolio: Portfolio = env
            .storage()
            .persistent()
            .get(&DataKey::PortfolioV2(pid))
            .unwrap();
        portfolio.target_allocations.set(asset.clone(), 9500);
        env.storage()
            .persistent()
            .set(&DataKey::PortfolioV2(pid), &portfolio);
    });

    env.ledger().with_mut(|li| {
        li.timestamp = 15_000;
    });

    let result = client.try_execute_rebalance(&pid, &Map::new(&env));
    assert_eq!(result, Err(Ok(Error::InvalidAllocationSum)));
}

// ── Portfolio value USD view (#862) ────────────────────────────────────

#[test]
fn integration_portfolio_value_usd_returns_correct_structure() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, mock_reflector::TestnetReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin, &reflector_id);

    let asset_a = create_token_and_mint(&env, &admin, &user, 2_000_000);
    let asset_b = create_token_and_mint(&env, &admin, &user, 1_000_000);

    let mut allocations = Map::new(&env);
    allocations.set(asset_a.clone(), 7000);
    allocations.set(asset_b.clone(), 3000);

    let mut asset_decimals = Map::new(&env);
    asset_decimals.set(asset_a.clone(), DEFAULT_ASSET_DECIMALS);
    asset_decimals.set(asset_b.clone(), DEFAULT_ASSET_DECIMALS);

    let pid = client.create_portfolio(
        &user,
        &allocations,
        &asset_decimals,
        &5,
        &50,
        &CURRENT_SLIPPAGE_POLICY_VERSION,
    );

    client.deposit(&pid, &asset_a, &1_000_000, &String::from_str(&env, ""));
    client.deposit(&pid, &asset_b, &500_000, &String::from_str(&env, ""));

    let valuation = client.get_portfolio_value_usd(&pid);

    assert!(valuation.total_usd_value > 0);
    assert_eq!(valuation.assets.len(), 2);

    for i in 0..valuation.assets.len() {
        let av = valuation.assets.get(i).unwrap();
        assert!(av.oracle_price > 0);
        assert!(av.quantity > 0);
        assert!(av.usd_value > 0);
        assert!(av.target_pct == 7000 || av.target_pct == 3000);
    }
}

// ── Emergency stop + rebalance flow ────────────────────────────────────

#[test]
fn integration_emergency_stop_blocks_rebalance() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| {
        li.timestamp = 10_000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, mock_reflector::TestnetReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin, &reflector_id);

    let asset_a = create_token_and_mint(&env, &admin, &user, 300_000_000);
    let asset_b = create_token_and_mint(&env, &admin, &user, 200_000_000);

    let mut allocations = Map::new(&env);
    allocations.set(asset_a.clone(), 5000);
    allocations.set(asset_b.clone(), 5000);

    let mut asset_decimals = Map::new(&env);
    asset_decimals.set(asset_a.clone(), DEFAULT_ASSET_DECIMALS);
    asset_decimals.set(asset_b.clone(), DEFAULT_ASSET_DECIMALS);

    let pid = client.create_portfolio(
        &user,
        &allocations,
        &asset_decimals,
        &5,
        &50,
        &CURRENT_SLIPPAGE_POLICY_VERSION,
    );

    client.deposit(&pid, &asset_a, &200_000_000, &String::from_str(&env, ""));
    client.deposit(&pid, &asset_b, &100_000_000, &String::from_str(&env, ""));

    client.set_emergency_stop(&true);

    env.ledger().with_mut(|li| {
        li.timestamp = 15_000;
    });

    let result = client.try_execute_rebalance(&pid, &Map::new(&env));
    assert_eq!(result, Err(Ok(Error::EmergencyStop)));

    client.set_emergency_stop(&false);
    let result = client.try_execute_rebalance(&pid, &Map::new(&env));
    assert!(result.is_ok());
}

// ── Post-rebalance on-chain balance verification ────────────────────────

#[test]
fn integration_post_rebalance_onchain_balances_match() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| {
        li.timestamp = 1_000_000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, mock_reflector::TestnetReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin, &reflector_id);

    // Create two tokens: asset_a (60%) and asset_b (40%)
    let asset_a = create_token_and_mint(&env, &admin, &user, 100_000_000);
    let asset_b = create_token_and_mint(&env, &admin, &user, 100_000_000);

    let mut allocations = Map::new(&env);
    allocations.set(asset_a.clone(), 6000);
    allocations.set(asset_b.clone(), 4000);

    let mut asset_decimals = Map::new(&env);
    asset_decimals.set(asset_a.clone(), DEFAULT_ASSET_DECIMALS);
    asset_decimals.set(asset_b.clone(), DEFAULT_ASSET_DECIMALS);

    let pid = client.create_portfolio(
        &user,
        &allocations,
        &asset_decimals,
        &5,
        &50,
        &CURRENT_SLIPPAGE_POLICY_VERSION,
    );

    // Deposit only into asset_a — portfolio starts imbalanced
    client.deposit(&pid, &asset_a, &100_000_000, &String::from_str(&env, ""));

    let token_a = TokenClient::new(&env, &asset_a);
    let token_b = TokenClient::new(&env, &asset_b);

    // Before rebalance: contract holds 100M of A, 0 of B; user holds 0 A, 100M B
    assert_eq!(token_a.balance(&contract_id), 100_000_000);
    assert_eq!(token_b.balance(&contract_id), 0);
    assert_eq!(token_a.balance(&user), 0);
    assert_eq!(token_b.balance(&user), 100_000_000);

    env.ledger().with_mut(|li| {
        li.timestamp = 1_000_000 + 5000;
    });

    client.execute_rebalance(&pid, &Map::new(&env));

    let portfolio = client.get_portfolio(&pid);

    // Verify on-chain balances match internal balances exactly
    let internal_a = portfolio.current_balances.get(asset_a.clone()).unwrap_or(0);
    let internal_b = portfolio.current_balances.get(asset_b.clone()).unwrap_or(0);

    assert_eq!(
        token_a.balance(&contract_id),
        internal_a,
        "on-chain A must match internal A"
    );
    assert_eq!(
        token_b.balance(&contract_id),
        internal_b,
        "on-chain B must match internal B"
    );

    // Total on-chain value should be preserved (100M A initially)
    // With mock price of 50 USD per unit, the split should be 60/40
    assert!(
        internal_a + internal_b <= 100_000_000,
        "total after rebalance should not exceed initial deposit"
    );
}

// ── Atomicity: failed rebalance does not alter balances ──────────────────

#[test]
fn integration_failed_rebalance_leaves_state_unchanged() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| {
        li.timestamp = 1_000_000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, mock_reflector::TestnetReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin, &reflector_id);

    let asset = create_token_and_mint(&env, &admin, &user, 100_000_000);

    let mut allocations = Map::new(&env);
    allocations.set(asset.clone(), 10000);

    let mut asset_decimals = Map::new(&env);
    asset_decimals.set(asset.clone(), DEFAULT_ASSET_DECIMALS);

    let pid = client.create_portfolio(
        &user,
        &allocations,
        &asset_decimals,
        &5,
        &50,
        &CURRENT_SLIPPAGE_POLICY_VERSION,
    );

    client.deposit(&pid, &asset, &50_000_000, &String::from_str(&env, ""));

    // Snapshot balances before a failed attempt
    let token = TokenClient::new(&env, &asset);
    let contract_balance_before = token.balance(&contract_id);
    let user_balance_before = token.balance(&user);

    // Corrupt allocations so rebalance fails validation
    use portfolio_rebalancer::{DataKey, Portfolio};
    env.as_contract(&contract_id, || {
        let mut portfolio: Portfolio = env
            .storage()
            .persistent()
            .get(&DataKey::PortfolioV2(pid))
            .unwrap();
        portfolio.target_allocations.set(asset.clone(), 5000);
        env.storage()
            .persistent()
            .set(&DataKey::PortfolioV2(pid), &portfolio);
    });

    env.ledger().with_mut(|li| {
        li.timestamp = 1_000_000 + 5000;
    });

    let result = client.try_execute_rebalance(&pid, &Map::new(&env));
    assert_eq!(result, Err(Ok(Error::InvalidAllocationSum)));

    // Verify on-chain balances are completely unchanged
    assert_eq!(
        token.balance(&contract_id),
        contract_balance_before,
        "contract balance unchanged after failed rebalance"
    );
    assert_eq!(
        token.balance(&user),
        user_balance_before,
        "user balance unchanged after failed rebalance"
    );

    // Internal portfolio state also unchanged
    let portfolio = client.get_portfolio(&pid);
    assert_eq!(
        portfolio.last_rebalance,
        1_000_000,
        "last_rebalance must not advance"
    );
}
