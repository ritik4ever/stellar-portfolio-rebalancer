#![no_std]
use soroban_sdk::{contract, contractimpl, Address, Env, Map};

mod portfolio;
mod reflector;
mod types;

pub use types::*;
pub use reflector::*;

#[contract]
pub struct PortfolioRebalancer;

#[contractimpl]
impl PortfolioRebalancer {
    pub fn initialize(env: Env, admin: Address, reflector_address: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::ReflectorAddress, &reflector_address);
    }

    pub fn create_portfolio(
        env: Env,
        user: Address,
        target_allocations: Map<Address, u32>,
        rebalance_threshold: u32,
    ) -> u64 {
        user.require_auth();
        
        let portfolio_id = env.ledger().sequence() as u64; // Convert u32 to u64
        let portfolio = Portfolio {
            user: user.clone(),
            target_allocations,
            current_balances: Map::new(&env),
            rebalance_threshold,
            last_rebalance: env.ledger().timestamp(),
            total_value: 0,
            is_active: true,
        };
        
        env.storage().persistent().set(&DataKey::Portfolio(portfolio_id), &portfolio);
        portfolio_id
    }

    pub fn get_portfolio(env: Env, portfolio_id: u64) -> Portfolio {
        env.storage().persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap()
    }

    pub fn deposit(env: Env, portfolio_id: u64, asset: Address, amount: i128) {
        let mut portfolio: Portfolio = env.storage().persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap();
        
        portfolio.user.require_auth();
        
        let current_balance = portfolio.current_balances.get(asset.clone()).unwrap_or(0);
        portfolio.current_balances.set(asset, current_balance + amount);
        
        env.storage().persistent().set(&DataKey::Portfolio(portfolio_id), &portfolio);
    }

    pub fn check_rebalance_needed(env: Env, portfolio_id: u64) -> bool {
        let portfolio: Portfolio = env.storage().persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap();
            
        // Simplified check - in real implementation would use Reflector
        let threshold = portfolio.rebalance_threshold as i128;
        threshold > 0 // Simplified logic
    }

    pub fn execute_rebalance(env: Env, portfolio_id: u64) {
        let mut portfolio: Portfolio = env.storage().persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap();
        
        portfolio.user.require_auth();
        
        portfolio.last_rebalance = env.ledger().timestamp();
        env.storage().persistent().set(&DataKey::Portfolio(portfolio_id), &portfolio);
        
        env.events().publish(
            ("rebalance", "executed"),
            (portfolio_id, env.ledger().timestamp())
        );
    }
}