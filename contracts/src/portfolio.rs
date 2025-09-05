use crate::types::*;
use soroban_sdk::{Address, Env, Map};

pub fn validate_allocations(allocations: &Map<Address, u32>) -> bool {
    let mut total = 0u32;
    for (_, percentage) in allocations.iter() {
        total += percentage;
    }
    total == 100
}

pub fn calculate_portfolio_value(
    _env: &Env, // Prefixed with underscore to indicate intentional non-use
    balances: &Map<Address, i128>,
    reflector_client: &crate::reflector::ReflectorClient,
) -> i128 {
    let mut total_value = 0i128;
    
    for (asset, balance) in balances.iter() {
        if let Some(price_data) = reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset)) {
            let value = (balance * price_data.price) / 10i128.pow(14);
            total_value += value;
        }
    }
    
    total_value
}

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
            
            if trade_amount.abs() > 1000000 { // Minimum trade threshold
                trades.set(asset, trade_amount);
            }
        }
    }
    
    trades
}