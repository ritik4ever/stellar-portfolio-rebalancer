// DCA (Dollar Cost Averaging) strategy implementation

use crate::{portfolio, types::*};
use soroban_sdk::Env;

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
    let portfolio = super::PortfolioRebalancer::load_portfolio(env, portfolio_id)?;

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
    let mut portfolio = super::PortfolioRebalancer::load_portfolio(env, portfolio_id)?;

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

    for (asset, target_percentage) in portfolio.target_allocations.iter() {
        let amount_to_invest =
            (config.amount * target_percentage as i128) / ALLOCATION_DENOMINATOR as i128;

        if amount_to_invest > 0 {
            let current_balance = portfolio.current_balances.get(asset.clone()).unwrap_or(0);

            portfolio
                .current_balances
                .set(asset, current_balance + amount_to_invest);
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

    Ok(())
}
