#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, Map};

#[test]
fn test_create_portfolio() {
    let env = Env::default();
    env.mock_all_auths();
    
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);
    
    let admin = Address::generate(&env);
    let reflector_address = Address::generate(&env);
    let user = Address::generate(&env);
    
    // Initialize contract
    client.initialize(&admin, &reflector_address);
    
    // Create portfolio
    let mut allocations = Map::new(&env);
    allocations.set(Address::generate(&env), 50);
    allocations.set(Address::generate(&env), 50);
    
    let portfolio_id = client.create_portfolio(&user, &allocations, &5);
    
    assert!(portfolio_id > 0);
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