use soroban_sdk::{Address, Env};
use crate::{types::*, portfolio, PortfolioRebalancer};

/// Configure custom rebalance strategy (min-days + threshold guard).
pub fn configure_custom(
    env: &Env,
    portfolio_id: u64,
    min_days: u64,
    threshold_bps: u32,
) -> Result<(), Error> {
    if !(CUSTOM_MIN_DAYS_BETWEEN_REBALANCE..=CUSTOM_MAX_DAYS_BETWEEN_REBALANCE).contains(&min_days) {
        return Err(Error::InvalidCooldown);
    }
    if !(MIN_REBALANCE_THRESHOLD..=MAX_REBALANCE_THRESHOLD).contains(&threshold_bps) {
        return Err(Error::InvalidThreshold);
    }

    let portfolio = PortfolioRebalancer::load_portfolio(env, portfolio_id)?;
    let steward: Address = env
        .storage()
        .persistent()
        .get(&DataKey::Steward(portfolio_id))
        .unwrap_or(portfolio.user.clone());
    steward.require_auth();

    let config = CustomStrategyConfig {
        min_days_between_rebalance: min_days,
        threshold_bps,
    };

    env.storage()
        .persistent()
        .set(&DataKey::CustomStrategyConfig(portfolio_id), &config);

    Ok(())
}

/// Check custom rebalance: min-days guard AND threshold exceeded.
pub fn check_custom_rebalance(env: &Env, portfolio: &Portfolio, config: &CustomStrategyConfig) -> bool {
    let current_ts = env.ledger().timestamp();
    let min_seconds = config.min_days_between_rebalance * 24 * 60 * 60;
    let enough_time_passed = current_ts.saturating_sub(portfolio.last_rebalance) >= min_seconds;

    if !enough_time_passed {
        return false;
    }

    // Reuse standard threshold check from preview
    let reflector_address: Address = env
        .storage()
        .instance()
        .get(&DataKey::ReflectorAddress)
        .unwrap();
    let reflector_client = crate::reflector::ReflectorClient::new(env, &reflector_address);

    if let Ok(preview) = portfolio::build_rebalance_preview(env, portfolio, &reflector_client) {
        preview.rebalance_needed && preview.total_value > 0
    } else {
        false
    }
}