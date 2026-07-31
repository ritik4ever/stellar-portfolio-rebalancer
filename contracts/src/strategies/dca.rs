// DCA (Dollar Cost Averaging) strategy implementation
use soroban_sdk::{Address, Env, Map};
use crate::{types::*, portfolio, PortfolioRebalancer};

/// Configure DCA settings for a portfolio.
/// Only the portfolio owner (or steward) may call.
pub fn configure_dca(
    env: &Env,
    portfolio_id: u64,
    enabled: bool,
    amount: i128,
    interval: u64,
) -> Result<(), Error> {
    // Authorization: portfolio owner or steward must auth
    let portfolio = PortfolioRebalancer::load_portfolio(env, portfolio_id)?;
    // Determine who can authorize: steward if set, else user
    let steward = env
        .storage()
        .persistent()
        .get(&DataKey::Steward(portfolio_id))
        .unwrap_or(portfolio.user.clone());
    steward.require_auth();

    if enabled {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if interval == 0 {
            return Err(Error::InvalidCooldown);
        }
    }

    let config = DCAConfig {
        enabled,
        amount,
        interval,
        // if enabling now, schedule next execution at current timestamp + interval
        next_execution: if enabled {
            env.ledger().timestamp() + interval
        } else {
            0
        },
    };
    env.storage()
        .persistent()
        .set(&DataKey::DCAConfig(portfolio_id), &config);
    Ok(())
}

/// Execute DCA for a portfolio if the schedule has arrived.
/// This adds capital according to target allocations without triggering rebalance.
pub fn execute_dca(env: &Env, portfolio_id: u64) -> Result<(), Error> {
    // Load portfolio and DCA config
    let mut portfolio = PortfolioRebalancer::load_portfolio(env, portfolio_id)?;
    let mut config: DCAConfig = match env
        .storage()
        .persistent()
        .get(&DataKey::DCAConfig(portfolio_id))
    {
        Some(c) => c,
        None => return Err(Error::InvalidAmount), // no config means disabled
    };

    if !config.enabled {
        return Err(Error::InvalidAmount);
    }

    let current_ts = env.ledger().timestamp();
    if current_ts < config.next_execution {
        // not yet time to execute
        return Err(Error::InvalidCooldown);
    }

    // Ensure portfolio is active
    if !portfolio.is_active {
        return Err(Error::PortfolioPaused);
    }

    // Get the invoker (steward or user) for event emission
    let invoker = env
        .storage()
        .persistent()
        .get(&DataKey::Steward(portfolio_id))
        .unwrap_or(portfolio.user.clone());

    // Assume USDC is represented by an asset address that exists in target allocations.
    // The DCA amount is split according to target allocation percentages.
    // For each asset, increase balance by proportional amount.
    let mut purchased: Map<Address, i128> = Map::new(env);
    for (asset, target_pct) in portfolio.target_allocations.iter() {
        // amount proportional to target percentage
        let to_invest = (config.amount * (target_pct as i128)) / (ALLOCATION_DENOMINATOR as i128);
        if to_invest > 0 {
            let current: i128 = portfolio.current_balances.get(asset.clone()).unwrap_or(0);
            portfolio
                .current_balances
                .set(asset.clone(), current + to_invest);
            purchased.set(asset.clone(), to_invest);
        }
    }

    // Update total_value (recalculate) and last DCA timestamp
    // For simplicity we reuse existing portfolio calculation utilities to recompute value.
    // Note: this does not affect last_rebalance.
    // Calculate total value via reflector price data.
    let reflector_address = env
        .storage()
        .instance()
        .get(&DataKey::ReflectorAddress)
        .unwrap();
    let reflector_client = crate::reflector::ReflectorClient::new(env, &reflector_address);
    let total_value = match portfolio::calculate_portfolio_value(
        env,
        &portfolio.current_balances,
        &portfolio.asset_decimals,
        &reflector_client,
    ) {
        Ok(v) => v,
        Err(_) => return Err(Error::StaleData),
    };
    portfolio.total_value = total_value;

    // Persist updated portfolio and DCA config (next execution)
    config.next_execution = current_ts + config.interval;
    env.storage()
        .persistent()
        .set(&DataKey::PortfolioV2(portfolio_id), &portfolio);
    env.storage()
        .persistent()
        .set(&DataKey::DCAConfig(portfolio_id), &config);

    // Emit event
    portfolio::emit_dca_executed(env, portfolio_id, config.amount, purchased, current_ts);
    Ok(())
}
