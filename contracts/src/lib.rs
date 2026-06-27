#![no_std]
use soroban_sdk::{contract, contractimpl, Address, Env, Map, BytesN};

pub mod portfolio;
pub mod reflector;
pub mod types;
pub mod upgrade;
pub mod events;

pub use types::*;
pub use reflector::*;

#[contract]
pub struct PortfolioRebalancer;

#[contractimpl]
impl PortfolioRebalancer {
    pub fn initialize(env: Env, admin: Address, reflector_address: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::ReflectorAddress, &reflector_address);
        env.storage().instance().set(&DataKey::EmergencyStop, &false);
        events::emit_admin_changed(&env, &admin, &admin, env.ledger().sequence() as u64);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        upgrade::upgrade(&env, new_wasm_hash);
    }

    pub fn set_paused(env: Env, paused: bool) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::EmergencyStop, &paused);
        events::emit_paused(&env, &admin, paused, env.ledger().sequence() as u64);
    }

    pub fn create_portfolio(
        env: Env,
        user: Address,
        target_allocations: Map<Address, u32>,
        rebalance_threshold: u32,
    ) -> u64 {
        if env.storage().instance().get(&DataKey::EmergencyStop).unwrap_or(false) {
            panic!("ContractPaused");
        }

        user.require_auth();
        
        let portfolio_id = env.ledger().sequence() as u64;
        let portfolio = Portfolio {
            user: user.clone(),
            target_allocations,
            current_balances: Map::new(&env),
            asset_decimals: Map::new(&env),
            rebalance_threshold,
            slippage_tolerance: 50,
            slippage_policy_version: 1,
            last_rebalance: env.ledger().timestamp(),
            total_value: 0,
            cooldown: 3600,
            is_active: true,
            pause_reason: PauseReason::None,
        };
        
        env.storage().persistent().set(&DataKey::Portfolio(portfolio_id), &portfolio);
        events::emit_portfolio_created(&env, &user, portfolio_id, env.ledger().sequence() as u64);
        
        portfolio_id
    }

    pub fn deposit(env: Env, portfolio_id: u64, asset: Address, amount: i128) {
        if env.storage().instance().get(&DataKey::EmergencyStop).unwrap_or(false) {
            panic!("ContractPaused");
        }

        let mut portfolio: Portfolio = env.storage().persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap();
        
        portfolio.user.require_auth();
        
        let current_balance = portfolio.current_balances.get(asset.clone()).unwrap_or(0);
        portfolio.current_balances.set(asset, current_balance + amount);
        
        env.storage().persistent().set(&DataKey::Portfolio(portfolio_id), &portfolio);
        events::emit_allocation_updated(&env, &portfolio.user, portfolio_id, env.ledger().sequence() as u64);
    }

    pub fn execute_rebalance(env: Env, portfolio_id: u64) {
        if env.storage().instance().get(&DataKey::EmergencyStop).unwrap_or(false) {
            panic!("ContractPaused");
        }

        let mut portfolio: Portfolio = env.storage().persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap();
        
        portfolio.user.require_auth();
        
        portfolio.last_rebalance = env.ledger().timestamp();
        env.storage().persistent().set(&DataKey::Portfolio(portfolio_id), &portfolio);
        
        events::emit_rebalance_executed(&env, &portfolio.user, portfolio_id, env.ledger().sequence() as u64);
    }
}
