// DCA (Dollar Cost Averaging) strategy implementation
use soroban_sdk::{Address, Env, Map};
use crate::{types::*, portfolio, PortfolioRebalancer};

/// Configure DCA settings for a portfolio.
///
/// Only the portfolio owner or configured steward may call this function.
pub fn configure_dca(
    env: &Env,
    portfolio_id: u64,
    enabled: bool,
    amount: i128,
    interval: u64,
) -> Result<(), Error> {
    let portfolio = PortfolioRebalancer::load_portfolio(env, portfolio_id)?;

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

/// Execute DCA for a portfolio when its configured schedule has arrived.
///
/// The configured amount is divided according to the portfolio's target
/// allocations. This operation does not update the last rebalance timestamp.
pub fn execute_dca(env: &Env, portfolio_id: u64) -> Result<(), Error> {
    let mut portfolio = PortfolioRebalancer::load_portfolio(env, portfolio_id)?;

    let mut config: DCAConfig = match env
        .storage()
        .persistent()
        .get(&DataKey::DCAConfig(portfolio_id))
    {
        Some(config) => config,
        None => return Err(Error::InvalidAmount),
    };

    if !config.enabled {
        return Err(Error::InvalidAmount);
    }

    let current_timestamp = env.ledger().timestamp();

    if current_timestamp < config.next_execution {
        return Err(Error::InvalidCooldown);
    }

    if !portfolio.is_active {
        return Err(Error::PortfolioPaused);
    }

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
                .set(asset, current + to_invest);
        }
    }

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
        Ok(value) => value,
        Err(_) => return Err(Error::StaleData),
    };

    portfolio.total_value = total_value;
    config.next_execution = current_timestamp + config.interval;

    env.storage()
        .persistent()
        .set(&DataKey::Portfolio(portfolio_id), &portfolio);

    env.storage()
        .persistent()
        .set(&DataKey::DCAConfig(portfolio_id), &config);

    // Emit event
    portfolio::emit_dca_executed(env, portfolio_id, config.amount, purchased, current_timestamp);
    Ok(())
}
