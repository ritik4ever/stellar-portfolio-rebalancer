#![no_std]
use soroban_sdk::{contract, contractimpl, Address, Env, Map};

mod portfolio;
mod reflector;
#[cfg(test)]
mod test;
mod types;

pub use reflector::*;
pub use types::*;

#[contract]
pub struct PortfolioRebalancer;

#[contractimpl]
impl PortfolioRebalancer {
    pub fn initialize(env: Env, admin: Address, reflector_address: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::ReflectorAddress, &reflector_address);
        env.storage().instance().set(&DataKey::Initialized, &true);
        Ok(())
    }

    pub fn create_portfolio(
        env: Env,
        user: Address,
        target_allocations: Map<Address, u32>,
        rebalance_threshold: u32,
        slippage_tolerance: u32,
    ) -> Result<u64, Error> {
        user.require_auth();

        if !portfolio::validate_allocations(&target_allocations) {
            return Err(Error::InvalidAllocation);
        }
        if target_allocations.len() > MAX_PORTFOLIO_ASSETS {
            return Err(Error::TooManyAssets);
        }

        if !(1..=50).contains(&rebalance_threshold) {
            return Err(Error::InvalidThreshold);
        }

        if !(10..=500).contains(&slippage_tolerance) {
            return Err(Error::InvalidSlippageTolerance);
        }

        let portfolio_id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::NextPortfolioId)
            .unwrap_or(1);
        env.storage()
            .persistent()
            .set(&DataKey::NextPortfolioId, &(portfolio_id + 1));

        let portfolio = Portfolio {
            user: user.clone(),
            target_allocations,
            current_balances: Map::new(&env),
            rebalance_threshold,
            slippage_tolerance,
            last_rebalance: env.ledger().timestamp(),
            total_value: 0,
            is_active: true,
        };

        portfolio::check_portfolio_invariants(&portfolio)?;

        env.storage()
            .persistent()
            .set(&DataKey::Portfolio(portfolio_id), &portfolio);
        portfolio::emit_portfolio_created(&env, portfolio_id, user);
        Ok(portfolio_id)
    }

    pub fn get_portfolio(env: Env, portfolio_id: u64) -> Portfolio {
        env.storage()
            .persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap()
    }

    pub fn check_invariants(env: Env, portfolio_id: u64) -> Result<(), Error> {
        let portfolio = Self::load_portfolio(&env, portfolio_id)?;
        portfolio::check_portfolio_invariants(&portfolio)
    }

    pub fn deposit(env: Env, portfolio_id: u64, asset: Address, amount: i128) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::InvalidWithdrawAmount);
        }

        if let Some(true) = env.storage().instance().get(&DataKey::EmergencyStop) {
            return Err(Error::EmergencyStop);
        }

        let mut portfolio = Self::load_portfolio(&env, portfolio_id)?;
        portfolio.user.require_auth();
        portfolio::check_portfolio_invariants(&portfolio)?;

        let current_balance = portfolio.current_balances.get(asset.clone()).unwrap_or(0);
        portfolio
            .current_balances
            .set(asset.clone(), current_balance + amount);

        env.storage()
            .persistent()
            .set(&DataKey::Portfolio(portfolio_id), &portfolio);
        portfolio::emit_portfolio_deposit(&env, portfolio_id, asset, amount);
        Ok(())
    }

    pub fn withdraw(
        env: Env,
        portfolio_id: u64,
        asset: Address,
        amount: i128,
    ) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::InvalidWithdrawAmount);
        }

        if let Some(true) = env.storage().instance().get(&DataKey::EmergencyStop) {
            return Err(Error::EmergencyStop);
        }

        let mut portfolio = Self::load_portfolio(&env, portfolio_id)?;
        portfolio.user.require_auth();
        portfolio::check_portfolio_invariants(&portfolio)?;

        let current_balance = portfolio.current_balances.get(asset.clone()).unwrap_or(0);
        if current_balance < amount {
            return Err(Error::InsufficientBalance);
        }

        let new_balance = current_balance - amount;
        if new_balance == 0 {
            portfolio.current_balances.remove(asset.clone());
        } else {
            portfolio.current_balances.set(asset.clone(), new_balance);
        }

        if !portfolio::portfolio_has_positive_balance(&portfolio) {
            portfolio.is_active = false;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Portfolio(portfolio_id), &portfolio);
        portfolio::emit_portfolio_withdraw(&env, portfolio_id, asset, amount);
        Ok(())
    }

    pub fn check_rebalance_needed(env: Env, portfolio_id: u64) -> bool {
        let portfolio: Portfolio = env
            .storage()
            .persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap();

        let reflector_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::ReflectorAddress)
            .unwrap();
        let reflector_client = ReflectorClient::new(&env, &reflector_address);

        let total_value = match portfolio::calculate_portfolio_value(
            &env,
            &portfolio.current_balances,
            &reflector_client,
        ) {
            Some(val) => val,
            None => return false,
        };

        if total_value == 0 {
            return false;
        }

        for (asset, target_percent) in portfolio.target_allocations.iter() {
            let current_balance = portfolio.current_balances.get(asset.clone()).unwrap_or(0);

            if let Some(price_data) =
                reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
            {
                let current_asset_value = (current_balance * price_data.price) / 10i128.pow(14);
                let current_percent = (current_asset_value * 100) / total_value;

                let drift = (current_percent - target_percent as i128).abs();
                if drift > portfolio.rebalance_threshold as i128 {
                    return true;
                }
            }
        }

        false
    }

    pub fn execute_rebalance(
        env: Env,
        portfolio_id: u64,
        actual_balances: Map<Address, i128>,
    ) -> Result<(), Error> {
        Self::execute_rebalance_internal(&env, portfolio_id, actual_balances, false, None)
    }

    pub fn admin_force_rebalance(
        env: Env,
        portfolio_id: u64,
        actual_balances: Map<Address, i128>,
    ) -> Result<(), Error> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        Self::execute_rebalance_internal(
            &env,
            portfolio_id,
            actual_balances,
            true,
            Some(admin),
        )
    }

    pub fn set_emergency_stop(env: Env, stop: bool) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::EmergencyStop, &stop);
    }

    fn load_portfolio(env: &Env, portfolio_id: u64) -> Result<Portfolio, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .ok_or(Error::PortfolioNotFound)
    }

    fn execute_rebalance_internal(
        env: &Env,
        portfolio_id: u64,
        actual_balances: Map<Address, i128>,
        bypass_cooldown: bool,
        override_admin: Option<Address>,
    ) -> Result<(), Error> {
        if let Some(true) = env.storage().instance().get(&DataKey::EmergencyStop) {
            return Err(Error::EmergencyStop);
        }

        let mut portfolio = Self::load_portfolio(env, portfolio_id)?;

        if !bypass_cooldown {
            portfolio.user.require_auth();
        }

        portfolio::check_portfolio_invariants(&portfolio)?;

        let current_time = env.ledger().timestamp();
        if !bypass_cooldown
            && current_time < portfolio.last_rebalance + REBALANCE_COOLDOWN_SECONDS
        {
            return Err(Error::CooldownActive);
        }

        let reflector_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::ReflectorAddress)
            .unwrap();
        let reflector_client = ReflectorClient::new(env, &reflector_address);

        for (asset, _) in portfolio.target_allocations.iter() {
            if let Some(price_data) =
                reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
            {
                if price_data.is_stale(current_time, PRICE_MAX_AGE_SECONDS) {
                    return Err(Error::StaleData);
                }
            } else {
                return Err(Error::StaleData);
            }
        }

        let mut has_actual_balances = false;
        for (_, _) in actual_balances.iter() {
            has_actual_balances = true;
            break;
        }
        if has_actual_balances {
            let total_value = portfolio::calculate_portfolio_value(
                env,
                &portfolio.current_balances,
                &reflector_client,
            )
            .ok_or(Error::StaleData)?;
            if total_value > 0 {
                for (asset, target_pct) in portfolio.target_allocations.iter() {
                    let price_data = reflector_client
                        .lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
                        .unwrap();
                    let price = price_data.price;
                    let expected_value = (total_value * target_pct as i128) / 100;
                    let expected_balance = (expected_value * 10i128.pow(14)) / price;
                    let actual_balance = actual_balances.get(asset.clone()).unwrap_or(0);
                    let expected_abs = if expected_balance >= 0 {
                        expected_balance
                    } else {
                        -expected_balance
                    };
                    if expected_abs > 0 {
                        let diff = expected_balance - actual_balance;
                        let diff_abs = if diff >= 0 { diff } else { -diff };
                        let slippage_bps = (diff_abs * 10000) / expected_abs;
                        if slippage_bps > portfolio.slippage_tolerance as i128 {
                            return Err(Error::SlippageExceeded);
                        }
                    }
                }
            }
        }

        portfolio.last_rebalance = current_time;
        env.storage()
            .persistent()
            .set(&DataKey::Portfolio(portfolio_id), &portfolio);

        if let Some(admin) = override_admin {
            portfolio::emit_cooldown_override(env, portfolio_id, admin, current_time);
        }
        portfolio::emit_portfolio_rebalanced(env, portfolio_id, current_time);
        Ok(())
    }
}
