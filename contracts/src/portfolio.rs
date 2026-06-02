use crate::types::*;
use soroban_sdk::{xdr::ToXdr, Address, Env, Map};

#[cfg(test)]
use core::sync::atomic::{AtomicUsize, Ordering};

#[cfg(test)]
static PORTFOLIO_STORAGE_LIMIT_OVERRIDE: AtomicUsize = AtomicUsize::new(usize::MAX);

#[cfg(test)]
pub fn set_portfolio_storage_limit_for_tests(limit: Option<usize>) {
    PORTFOLIO_STORAGE_LIMIT_OVERRIDE.store(limit.unwrap_or(usize::MAX), Ordering::Relaxed);
}

fn portfolio_storage_limit_bytes() -> usize {
    #[cfg(test)]
    {
        let override_limit = PORTFOLIO_STORAGE_LIMIT_OVERRIDE.load(Ordering::Relaxed);
        if override_limit == usize::MAX {
            MAX_PORTFOLIO_STORAGE_BYTES as usize
        } else {
            override_limit
        }
    }

    #[cfg(not(test))]
    {
        MAX_PORTFOLIO_STORAGE_BYTES as usize
    }
}

const STORAGE_FOOTPRINT_HEADROOM_BYTES: usize = 64;

pub fn estimate_portfolio_storage_footprint(
    env: &Env,
    portfolio_id: u64,
    portfolio: &Portfolio,
) -> usize {
    let key_bytes = DataKey::Portfolio(portfolio_id).to_xdr(env);
    let value_bytes = portfolio.clone().to_xdr(env);
    key_bytes.len() as usize + value_bytes.len() as usize + STORAGE_FOOTPRINT_HEADROOM_BYTES
}

pub fn validate_portfolio_storage_footprint(
    env: &Env,
    portfolio_id: u64,
    portfolio: &Portfolio,
) -> Result<usize, Error> {
    let estimated = estimate_portfolio_storage_footprint(env, portfolio_id, portfolio);
    if estimated > portfolio_storage_limit_bytes() {
        Err(Error::PortfolioStorageFootprintTooLarge)
    } else {
        Ok(estimated)
    }
}

pub fn validate_allocations(allocations: &Map<Address, u32>) -> bool {
    if allocations.is_empty() {
        return false;
    }

    let mut total = 0u32;
    for (_, percentage) in allocations.iter() {
        if percentage == 0 {
            return false;
        }
        total = match total.checked_add(percentage) {
            Some(next_total) => next_total,
            None => return false,
        };
    }
    total == 100
}

pub fn calculate_portfolio_value(
    env: &Env,
    balances: &Map<Address, i128>,
    reflector_client: &crate::reflector::ReflectorClient,
) -> Option<i128> {
    let mut total_value = 0i128;
    let current_time = env.ledger().timestamp();

    for (asset, balance) in balances.iter() {
        if let Some(price_data) =
            reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset))
        {
            // Check for stale price (e.g., 1 hour)
            if price_data.timestamp + 3600 < current_time {
                return None;
            }
            let value = (balance * price_data.price) / 10i128.pow(14);
            total_value += value;
        } else {
            // If any asset price is missing, we can't calculate a reliable total value
            return None;
        }
    }

    Some(total_value)
}

#[allow(dead_code)]
pub fn calculate_rebalance_trades(
    env: &Env,
    portfolio: &Portfolio,
    current_prices: &Map<Address, i128>,
) -> Map<Address, i128> {
    let mut trades = Map::new(env);
    let total_value = portfolio.total_value;

    for (asset, target_percentage) in portfolio.target_allocations.iter() {
        let current_balance = portfolio.current_balances.get(asset.clone()).unwrap_or(0);
        let target_value = (total_value * target_percentage as i128) / 100;

        if let Some(price) = current_prices.get(asset.clone()) {
            let target_balance = (target_value * 10i128.pow(14)) / price;
            let trade_amount = target_balance - current_balance;

            if trade_amount.abs() > MIN_TRADE_AMOUNT_STROOPS {
                trades.set(asset, trade_amount);
            }
        }
    }

    trades
}
