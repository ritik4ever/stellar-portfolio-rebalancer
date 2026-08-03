use soroban_sdk::{Address, Env};
use crate::{types::*, portfolio, PortfolioRebalancer};

/// Configure periodic rebalance strategy for a portfolio.
pub fn configure_periodic(
    env: &Env,
    portfolio_id: u64,
    interval_ledgers: u64,
) -> Result<(), Error> {
    if !(PERIODIC_MIN_INTERVAL_LEDGERS..=PERIODIC_MAX_INTERVAL_LEDGERS).contains(&interval_ledgers) {
        return Err(Error::InvalidCooldown);
    }

    let portfolio = PortfolioRebalancer::load_portfolio(env, portfolio_id)?;
    let steward: Address = env
        .storage()
        .persistent()
        .get(&DataKey::Steward(portfolio_id))
        .unwrap_or(portfolio.user.clone());
    steward.require_auth();

    // Store config on portfolio struct by switching strategy
    // and saving ledger interval
    let config = PeriodicConfig { interval_ledgers };

    env.storage()
        .persistent()
        .set(&DataKey::PeriodicConfig(portfolio_id), &config);

    Ok(())
}

/// Check if periodic rebalance is due based on ledger sequence since last rebalance.
pub fn check_periodic_rebalance(env: &Env, portfolio: &Portfolio, config: &PeriodicConfig) -> bool {
    let current_ledger = env.ledger().sequence();
    let next_ledger: u64 = portfolio
        .last_rebalance
        .saturating_add(config.interval_ledgers);
    u64::from(current_ledger) >= next_ledger
}
