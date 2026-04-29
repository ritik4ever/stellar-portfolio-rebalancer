use crate::types::*;
use soroban_sdk::{Address, Env, Map};

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
