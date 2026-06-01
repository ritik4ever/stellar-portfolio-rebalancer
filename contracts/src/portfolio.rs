use crate::types::*;
use soroban_sdk::{Address, Env, Map, Symbol};

pub fn emit_portfolio_created(env: &Env, portfolio_id: u64, user: Address) {
    env.events().publish(
        (Symbol::new(env, "portfolio"), Symbol::new(env, "created")),
        (portfolio_id, user),
    );
}

pub fn emit_portfolio_deposit(env: &Env, portfolio_id: u64, asset: Address, amount: i128) {
    env.events().publish(
        (Symbol::new(env, "portfolio"), Symbol::new(env, "deposit")),
        (portfolio_id, asset, amount),
    );
}

pub fn emit_portfolio_withdraw(env: &Env, portfolio_id: u64, asset: Address, amount: i128) {
    env.events().publish(
        (Symbol::new(env, "portfolio"), Symbol::new(env, "withdraw")),
        (portfolio_id, asset, amount),
    );
}

pub fn emit_portfolio_rebalanced(env: &Env, portfolio_id: u64, timestamp: u64) {
    env.events().publish(
        (Symbol::new(env, "portfolio"), Symbol::new(env, "rebalanced")),
        (portfolio_id, timestamp),
    );
}

pub fn emit_cooldown_override(env: &Env, portfolio_id: u64, admin: Address, timestamp: u64) {
    env.events().publish(
        (
            Symbol::new(env, "portfolio"),
            Symbol::new(env, "cooldown_override"),
        ),
        (portfolio_id, admin, timestamp),
    );
}

pub fn check_portfolio_invariants(portfolio: &Portfolio) -> Result<(), Error> {
    if !portfolio.is_active {
        return Err(Error::PortfolioInactive);
    }
    if !validate_allocations(&portfolio.target_allocations) {
        return Err(Error::InvariantViolation);
    }
    if portfolio.target_allocations.len() > MAX_PORTFOLIO_ASSETS {
        return Err(Error::InvariantViolation);
    }
    if !(1..=50).contains(&portfolio.rebalance_threshold) {
        return Err(Error::InvariantViolation);
    }
    if !(10..=500).contains(&portfolio.slippage_tolerance) {
        return Err(Error::InvariantViolation);
    }
    for (_, balance) in portfolio.current_balances.iter() {
        if balance < 0 {
            return Err(Error::InvariantViolation);
        }
    }
    Ok(())
}

pub fn portfolio_has_positive_balance(portfolio: &Portfolio) -> bool {
    for (_, balance) in portfolio.current_balances.iter() {
        if balance > 0 {
            return true;
        }
    }
    false
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
            if price_data.timestamp + PRICE_MAX_AGE_SECONDS < current_time {
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
