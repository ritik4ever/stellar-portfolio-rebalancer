#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env, Map};

// Mock Reflector Contract
mod reflector_contract {
    use soroban_sdk::{contract, contractimpl, Env, Vec, Symbol};
    use crate::reflector::{Asset, PriceData};

    #[contract]
    pub struct MockReflector;

    #[contractimpl]
    impl MockReflector {
        pub fn base(_env: Env) -> Asset {
            Asset::Other(Symbol::new(&_env, "USD"))
        }
        pub fn assets(_env: Env) -> Vec<Asset> {
            Vec::new(&_env)
        }
        pub fn decimals(_env: Env) -> u32 {
            14
        }
        pub fn lastprice(env: Env, asset: Asset) -> Option<PriceData> {
            let price = match asset {
                Asset::Stellar(_addr) => {
                    // Simple mock: based on last byte of address to give different prices
                    // 100 * 10^14 base price
                    100_00000000000000i128
                },
                _ => 100_00000000000000i128,
            };
            
            Some(PriceData {
                price,
                timestamp: env.ledger().timestamp(),
            })
        }
        pub fn twap(_env: Env, _asset: Asset, _records: u32) -> Option<i128> {
            Some(100_00000000000000i128)
        }
    }
}

#[test]
fn test_create_portfolio() {
    let env = Env::default();
    env.mock_all_auths();
    // Set sequence > 0 so portfolio_id > 0
    env.ledger().with_mut(|li| {
        li.sequence_number = 1;
    });
    
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    // reflector_id is already an Address
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    
    // Initialize contract
    client.initialize(&admin, &reflector_id);
    
    // Create portfolio
    let mut allocations = Map::new(&env);
    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);
    allocations.set(asset1, 50);
    allocations.set(asset2, 50);
    
    let portfolio_id = client.create_portfolio(&user, &allocations, &5);
    
    assert!(portfolio_id > 0);
}

#[test]
fn test_deposit_valid() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 100);
    let pid = client.create_portfolio(&user, &allocations, &5);

    client.deposit(&pid, &asset, &1000);
    
    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.current_balances.get(asset).unwrap(), 1000);
}

#[test]
#[should_panic(expected = "Amount must be positive")]
fn test_deposit_invalid_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 100);
    let pid = client.create_portfolio(&user, &allocations, &5);

    client.deposit(&pid, &asset, &0);
}

#[test]
fn test_check_rebalance_needed_no_drift() {
    let env = Env::default();
    env.mock_all_auths();
    
    // Setup timestamps
    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset1 = Address::generate(&env); // Price 100
    let asset2 = Address::generate(&env); // Price 100
    allocations.set(asset1.clone(), 50);
    allocations.set(asset2.clone(), 50);
    
    let pid = client.create_portfolio(&user, &allocations, &5);

    // Deposit equal amounts to have 50/50 split (allocations 50/50)
    // Both mocked assets have price 100
    client.deposit(&pid, &asset1, &100); 
    client.deposit(&pid, &asset2, &100);

    assert_eq!(client.check_rebalance_needed(&pid), false);
}

#[test]
fn test_check_rebalance_needed_with_drift() {
    let env = Env::default();
    env.mock_all_auths();
    
    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset1 = Address::generate(&env);
    let asset2 = Address::generate(&env);
    allocations.set(asset1.clone(), 50);
    allocations.set(asset2.clone(), 50);
    
    let pid = client.create_portfolio(&user, &allocations, &5); // 5% threshold

    // Create significant drift
    // Asset1: 200 units * 100 price = 20000 val
    // Asset2: 100 units * 100 price = 10000 val
    // Total = 30000. 
    // Asset1: 66.6%, Target 50% -> Drift 16.6% > 5%
    client.deposit(&pid, &asset1, &200);
    client.deposit(&pid, &asset2, &100);

    assert_eq!(client.check_rebalance_needed(&pid), true);
}

#[test]
fn test_execute_rebalance_success() {
    let env = Env::default();
    env.mock_all_auths();
    
    env.ledger().with_mut(|li| {
        li.timestamp = 10000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset, 100);
    
    let pid = client.create_portfolio(&user, &allocations, &5);
    
    // Set timestamp way past last_rebalance (which was 10000 at creation)
    env.ledger().with_mut(|li| {
        li.timestamp = 20000;
    });

    client.execute_rebalance(&pid);
    
    let portfolio = client.get_portfolio(&pid);
    assert_eq!(portfolio.last_rebalance, 20000);
}

#[test]
#[should_panic(expected = "Cooldown active")]
fn test_execute_rebalance_cooldown() {
    let env = Env::default();
    env.mock_all_auths();
    
    env.ledger().with_mut(|li| {
        li.timestamp = 10000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset, 100);
    let pid = client.create_portfolio(&user, &allocations, &5);
    
    // Try to rebalance immediately (default last_rebalance is timestamp at creation)
    // Current time 10000 + 10s < 10000 + 3600
    env.ledger().with_mut(|li| {
        li.timestamp = 10010;
    });
    
    client.execute_rebalance(&pid);
}

#[test]
#[should_panic(expected = "Emergency stop active")]
fn test_emergency_stop() {
    let env = Env::default();
    env.mock_all_auths();
    
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    client.set_emergency_stop(&true);
    
    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset.clone(), 100);
    
    // Try deposit (should panic)
    // Note: creating portfolio might work depending on implementation, 
    // but deposit/rebalance should fail. Validating deposit fail here.
    let pid = client.create_portfolio(&user, &allocations, &5);
    client.deposit(&pid, &asset, &100);
}

#[test]
#[should_panic(expected = "Stale price data")]
fn test_stale_data() {
    let env = Env::default();
    env.mock_all_auths();
    
    // Initial time
    env.ledger().with_mut(|li| {
        li.timestamp = 10000;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    
    // We can't easily mock "stale" data with just one mock impl unless we make it stateful or allow setting it.
    // For this test, notice our mock uses `env.ledger().timestamp()` for price timestamp.
    // So if we create the portfolio (and reflector checks env time), then advance time significantly 
    // without "updating" the reflector (reflector always returns current env time in simple mock),
    // wait... in the simple mock `lastprice` returns `env.ledger().timestamp()`. 
    // So to simulate stale data, we need a MockReflector that returns OLD timestamps.
    // Since we can't easily swap mocks or change logic dynamically in this simple setup without complex mocking,
    // we can rely on verifying the *logic* in other ways or make the Mock configurable.
    //
    // Let's create a separate StaleMockReflector for this test.
    
    mod stale_reflector {
        use soroban_sdk::{contract, contractimpl, Env, Vec, Symbol};
        use crate::reflector::{Asset, PriceData};

        #[contract]
        pub struct StaleReflector;

        #[contractimpl]
        impl StaleReflector {
            pub fn base(_env: Env) -> Asset { Asset::Other(Symbol::new(&_env, "USD")) }
            pub fn assets(_env: Env) -> Vec<Asset> { Vec::new(&_env) }
            pub fn decimals(_env: Env) -> u32 { 14 }
            pub fn lastprice(env: Env, _asset: Asset) -> Option<PriceData> {
                // Return data from 2 hours ago (7200s)
                let current = env.ledger().timestamp();
                Some(PriceData {
                    price: 100_00000000000000,
                    timestamp: current - 7200,
                })
            }
            pub fn twap(_env: Env, _asset: Asset, _records: u32) -> Option<i128> { Some(0) }
        }
    }
    
    let stale_reflector_id = env.register_contract(None, stale_reflector::StaleReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &stale_reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset, 100);
    let pid = client.create_portfolio(&user, &allocations, &5);
    
    // Advance time to pass cooldown so that's not the error
    env.ledger().with_mut(|li| {
        li.timestamp = 20000;
    });

    client.execute_rebalance(&pid);
}

#[test]
fn test_edge_case_single_asset() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    client.initialize(&Address::generate(&env), &reflector_id);

    let mut allocations = Map::new(&env);
    let asset = Address::generate(&env);
    allocations.set(asset, 100);
    
    let pid = client.create_portfolio(&Address::generate(&env), &allocations, &5);
    // Single asset should never need rebalancing if it's 100%? 
    // Well, technically drift is 0. 
    assert_eq!(client.check_rebalance_needed(&pid), false);
}

#[test]
fn test_portfolio_validation() {
    let env = Env::default();
    let mut allocations = Map::new(&env);
    
    // Test valid allocation (sums to 100)
    allocations.set(Address::generate(&env), 60);
    allocations.set(Address::generate(&env), 40);
    assert!(crate::portfolio::validate_allocations(&allocations));
    
    // Test invalid allocation (doesn't sum to 100)
    let mut invalid_allocations = Map::new(&env);
    invalid_allocations.set(Address::generate(&env), 60);
    invalid_allocations.set(Address::generate(&env), 30);
    assert!(!crate::portfolio::validate_allocations(&invalid_allocations));
}

#[test]
#[should_panic]
fn test_initialize_guard() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);

    client.initialize(&admin, &reflector_id);
    // Second call must fail
    client.initialize(&admin, &reflector_id);
}

#[test]
#[should_panic]
fn test_create_portfolio_invalid_allocation() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    allocations.set(Address::generate(&env), 60);
    allocations.set(Address::generate(&env), 30); // sums to 90, not 100
    client.create_portfolio(&user, &allocations, &5);
}

#[test]
#[should_panic]
fn test_create_portfolio_threshold_too_low() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    allocations.set(Address::generate(&env), 100);
    client.create_portfolio(&user, &allocations, &0); // threshold 0 is invalid
}

#[test]
#[should_panic]
fn test_create_portfolio_threshold_too_high() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    allocations.set(Address::generate(&env), 100);
    client.create_portfolio(&user, &allocations, &51); // threshold 51 is invalid
}

#[test]
fn test_create_portfolio_multiple_same_ledger() {
    let env = Env::default();
    env.mock_all_auths();
    // Simulate same ledger
    env.ledger().with_mut(|li| {
        li.sequence_number = 1;
    });

    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    let reflector_id = env.register_contract(None, reflector_contract::MockReflector);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    client.initialize(&admin, &reflector_id);

    let mut allocations = Map::new(&env);
    allocations.set(Address::generate(&env), 100);

    // Call twice in same sequence state
    let pid1 = client.create_portfolio(&user, &allocations, &5);
    let pid2 = client.create_portfolio(&user, &allocations, &5);

    assert_eq!(pid1, 1, "First portfolio ID should start at 1");
    assert_eq!(pid2, 2, "Second portfolio ID should be 2");
    assert_ne!(pid1, pid2, "Portfolio IDs must be unique even in the same ledger");
}

