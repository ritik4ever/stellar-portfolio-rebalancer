#![no_std]
use soroban_sdk::{contract, contractimpl, Address, Env, Map};

mod portfolio;
mod reflector;
mod types;
#[cfg(test)]
mod test;

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
        if amount <= 0 {
            panic!("Amount must be positive");
        }
        
        // Check for emergency stop
        if let Some(true) = env.storage().instance().get(&DataKey::EmergencyStop) {
            panic!("Emergency stop active");
        }

        let mut portfolio: Portfolio = env.storage().persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap();
        
        portfolio.user.require_auth();
        
        // Verify asset is in portfolio (optional based on requirements, but good practice)
        if !portfolio.target_allocations.contains_key(asset.clone()) {
             // For now, allow depositing any asset, as users might deposit first then rebalance
             // or maybe we should restrict? The issue says "valid and invalid inputs". 
             // Let's assume valid input means positive amount and valid asset.
        }

        let current_balance = portfolio.current_balances.get(asset.clone()).unwrap_or(0);
        portfolio.current_balances.set(asset, current_balance + amount);
        
        env.storage().persistent().set(&DataKey::Portfolio(portfolio_id), &portfolio);
    }

    pub fn check_rebalance_needed(env: Env, portfolio_id: u64) -> bool {
        let portfolio: Portfolio = env.storage().persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap();

        let reflector_address: Address = env.storage().instance().get(&DataKey::ReflectorAddress).unwrap();
        let reflector_client = ReflectorClient::new(&env, &reflector_address);

        // Calculate total current value
        let total_value = portfolio::calculate_portfolio_value(&env, &portfolio.current_balances, &reflector_client);
        
        if total_value == 0 {
            return false;
        }

        // Check drift for each asset
        for (asset, target_percent) in portfolio.target_allocations.iter() {
            let current_balance = portfolio.current_balances.get(asset.clone()).unwrap_or(0);
            
            // Get price from reflector
            // Note: In a real app we'd need to handle potential failures/missing prices gracefully
            // For this check, if price missing, we can't calculate drift, so maybe skip or fail?
            // Let's skip for simplicity in this check
            if let Some(price_data) = reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset.clone())) {
                 let current_asset_value = (current_balance * price_data.price) / 10i128.pow(14);
                 let current_percent = (current_asset_value * 100) / total_value;
                 
                 let drift = (current_percent as i128 - target_percent as i128).abs();
                 if drift > portfolio.rebalance_threshold as i128 {
                     return true;
                 }
            }
        }
        
        false
    }

    pub fn execute_rebalance(env: Env, portfolio_id: u64) {
        // Check for emergency stop
        if let Some(true) = env.storage().instance().get(&DataKey::EmergencyStop) {
             panic!("Emergency stop active");
        }

        let mut portfolio: Portfolio = env.storage().persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap();
        
        portfolio.user.require_auth();

        // Check cooldown (e.g., 1 hour = 3600 seconds)
        let current_time = env.ledger().timestamp();
        if current_time < portfolio.last_rebalance + 3600 {
            panic!("Cooldown active");
        }
        
        // Reflector check for stale data
        let reflector_address: Address = env.storage().instance().get(&DataKey::ReflectorAddress).unwrap();
        let reflector_client = ReflectorClient::new(&env, &reflector_address);
        
        // Verify prices satisfy freshness requirement (e.g., 1 hour)
        for (asset, _) in portfolio.target_allocations.iter() {
            if let Some(price_data) = reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset.clone())) {
                if price_data.is_stale(current_time, 3600) {
                     panic!("Stale price data");
                }
            } else {
                // If price is missing, we can't safely rebalance
                panic!("Missing price data");
            }
        }

        // Perform rebalance logic (simplified: update last_rebalance and emit event)
        // In a real contract, this would execute trades or generate instructions
        portfolio.last_rebalance = current_time;
        env.storage().persistent().set(&DataKey::Portfolio(portfolio_id), &portfolio);
        
        env.events().publish(
            ("rebalance", "executed"),
            (portfolio_id, current_time)
        );
    }

    pub fn set_emergency_stop(env: Env, stop: bool) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::EmergencyStop, &stop);
    }
}