// Volatility-based rebalance strategy.
use crate::reflector::{Asset, ReflectorClient};
use crate::types::{DataKey, Error, VolatilityStrategyConfig, ALLOCATION_DENOMINATOR};
use soroban_sdk::{Address, Env};

/// Configure the volatility strategy for a portfolio.
/// Only the portfolio owner (or steward) may call.
pub fn configure_volatility_strategy(
    env: &Env,
    portfolio_id: u64,
    enabled: bool,
    threshold_bps: u32,
    window_seconds: u64,
) -> Result<(), Error> {
    let portfolio = super::PortfolioRebalancer::load_portfolio(env, portfolio_id)?;
    let steward: Address = env
        .storage()
        .persistent()
        .get(&DataKey::Steward(portfolio_id))
        .unwrap_or(portfolio.user.clone());
    steward.require_auth();

    if enabled && (threshold_bps == 0 || threshold_bps > ALLOCATION_DENOMINATOR) {
        return Err(Error::InvalidVolatilityThreshold);
    }

    let config = VolatilityStrategyConfig {
        enabled,
        threshold_bps,
        window_seconds,
    };
    env.storage()
        .persistent()
        .set(&DataKey::VolatilityConfig(portfolio_id), &config);
    Ok(())
}

/// Returns true once any asset's observed volatility (the deviation between
/// its last price and its TWAP over the configured window) crosses the
/// portfolio's configured threshold. Reuses the same TWAP-deviation math as
/// `circuit_breaker::check_volatility` (last price vs. TWAP, basis-point
/// deviation) but flags rather than halting the portfolio.
pub fn check_volatility_rebalance_needed(env: &Env, portfolio_id: u64) -> bool {
    let portfolio = match super::PortfolioRebalancer::load_portfolio(env, portfolio_id) {
        Ok(p) => p,
        Err(_) => return false,
    };

    let config: VolatilityStrategyConfig = match env
        .storage()
        .persistent()
        .get(&DataKey::VolatilityConfig(portfolio_id))
    {
        Some(c) if c.enabled => c,
        _ => return false,
    };

    let reflector_address: Address =
        match env.storage().instance().get(&DataKey::ReflectorAddress) {
            Some(a) => a,
            None => return false,
        };
    let client = ReflectorClient::new(env, &reflector_address);
    let records = (config.window_seconds / 60).max(1) as u32;

    for (asset, _) in portfolio.current_balances.iter() {
        let stellar_asset = Asset::Stellar(asset.clone());

        let current_price = match client.lastprice(&stellar_asset) {
            Some(p) => p.price,
            None => continue,
        };
        let historical_price = match client.twap(&stellar_asset, records) {
            Some(p) if p > 0 => p,
            _ => continue,
        };

        let diff = current_price - historical_price;
        let diff_abs = if diff < 0 { -diff } else { diff };
        let deviation_bps = (diff_abs * 10000) / historical_price;

        if deviation_bps > config.threshold_bps as i128 {
            env.events().publish(
                ("VolatilityRebalanceFlagged", asset.clone()),
                (deviation_bps, config.threshold_bps),
            );
            return true;
        }
    }

    false
}
