const fs = require('fs');

let content = fs.readFileSync('contracts/src/test.rs', 'utf8');

// 1. Fix create_portfolio_with_defaults
const old_create = `fn create_portfolio_with_defaults(
    env: &Env,
    client: &PortfolioRebalancerClient,
    user: &Address,
    allocations: &Map<Address, u32>,
    rebalance_threshold: u32,
    slippage_tolerance: u32,
) -> u64 {
    let asset_decimals = allocation_decimals(env, allocations, DEFAULT_ASSET_DECIMALS);
    client.create_portfolio(
        user,
        allocations,
        &asset_decimals,
        &rebalance_threshold,
        &slippage_tolerance,
        &CURRENT_SLIPPAGE_POLICY_VERSION,
    )
}`;
const new_create = `fn create_portfolio_with_defaults(
    env: &Env,
    client: &PortfolioRebalancerClient,
    user: &Address,
    allocations: &Map<Address, u32>,
    rebalance_threshold: u32,
    slippage_tolerance: u32,
) -> u64 {
    let asset_decimals = allocation_decimals(env, allocations, DEFAULT_ASSET_DECIMALS);
    let asset_thresholds = Map::new(env);
    client.create_portfolio(
        user,
        allocations,
        &asset_decimals,
        &asset_thresholds,
        &rebalance_threshold,
        &slippage_tolerance,
        &CURRENT_SLIPPAGE_POLICY_VERSION,
    )
}`;
content = content.replace(old_create, new_create);

// 2. Add test_double_initialize_fails
const test_deposit = `#[test]
fn test_deposit_valid() {`;
const new_test_deposit = `#[test]
#[should_panic(expected = "Error(Contract, 7)")]
fn test_double_initialize_fails() {
    let env = Env::default();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let reflector_id = Address::generate(&env);

    client.initialize(&admin1, &reflector_id);
    
    // This should panic with AlreadyInitialized (Error code 7)
    client.initialize(&admin2, &reflector_id);
}

#[test]
fn test_deposit_valid() {`;
content = content.replace(test_deposit, new_test_deposit);

fs.writeFileSync('contracts/src/test.rs', content);
