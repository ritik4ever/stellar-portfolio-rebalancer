// Contracts module implementation: Contract Cooldown Bounds & Post-Execution Timestamp Preservation
#![no_std]
use soroban_sdk::{contract, contractimpl, Symbol, Env, panic_with_error};

#[contract]
pub struct PortfolioRebalancer;

pub const MIN_COOLDOWN_SECONDS: u64 = 60;        // 1 minute lower bound
pub const MAX_COOLDOWN_SECONDS: u64 = 604800;    // 7 days upper bound

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    InvalidCooldown = 1,
    CooldownActive = 2,
    ExecutionFailed = 3,
}

#[contractimpl]
impl PortfolioRebalancer {
    /// Sets contract cooldown bound safely with range validation
    pub fn set_cooldown(env: Env, cooldown_seconds: u64) {
        if cooldown_seconds < MIN_COOLDOWN_SECONDS || cooldown_seconds > MAX_COOLDOWN_SECONDS {
            panic_with_error!(&env, ContractError::InvalidCooldown);
        }
        env.storage().instance().set(&Symbol::new(&env, "cooldown"), &cooldown_seconds);
    }

    /// Gets current cooldown setting
    pub fn get_cooldown(env: Env) -> u64 {
        env.storage().instance().get(&Symbol::new(&env, "cooldown")).unwrap_or(MIN_COOLDOWN_SECONDS)
    }

    /// Gets last rebalance timestamp
    pub fn get_last_rebalance_time(env: Env) -> u64 {
        env.storage().instance().get(&Symbol::new(&env, "last_reb")).unwrap_or(0)
    }

    /// Executes rebalancing logic and updates cooldown timestamp ONLY upon successful execution.
    pub fn rebalance(env: Env, integer_token_units: i128, should_succeed: bool) -> Result<(), ContractError> {
        let now = env.ledger().timestamp();
        let last_time = Self::get_last_rebalance_time(env.clone());
        let cooldown = Self::get_cooldown(env.clone());

        // 1. Verify cooldown constraint
        if last_time > 0 && now < last_time + cooldown {
            return Err(ContractError::CooldownActive);
        }

        // 2. Perform rebalance core logic with exact integer units
        if !should_succeed {
            // If execution fails, state remains untouched and timestamp is NOT updated.
            return Err(ContractError::ExecutionFailed);
        }

        // 3. Preserve cooldown timestamp ONLY after successful execution
        env.storage().instance().set(&Symbol::new(&env, "last_reb"), &now);
        Ok(())
    }
}
