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
use soroban_sdk::{Address, Env, Map, Vec};

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

pub fn balance_to_value(balance: i128, price: i128) -> i128 {
    (balance * price) / 10i128.pow(REFLECTOR_PRICE_DECIMALS)
}

pub fn value_to_balance(value: i128, price: i128, _asset_decimals: u32) -> i128 {
    if price == 0 {
        return 0;
    }
    (value * 10i128.pow(REFLECTOR_PRICE_DECIMALS)) / price
}

pub fn calculate_portfolio_value(
    env: &Env,
    balances: &Map<Address, i128>,
    asset_decimals: &Map<Address, u32>,
    reflector_client: &crate::reflector::ReflectorClient,
) -> Option<i128> {
    let mut total_value = 0i128;
    let current_time = env.ledger().timestamp();

    for (asset, balance) in balances.iter() {
        let _decimals = asset_decimals
            .get(asset.clone())
            .unwrap_or(DEFAULT_ASSET_DECIMALS);
        if let Some(price_data) =
            reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset))
        {
            // Check for stale price (e.g., 1 hour)
            if price_data.timestamp + PRICE_MAX_AGE_SECONDS < current_time {
            if price_data.timestamp + 3600 < current_time {
                return None;
            }
            total_value += balance_to_value(balance, price_data.price);
        } else {
            return None;
        }
    }

    Some(total_value)
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
        let asset_decimals = asset_decimals_for(portfolio, asset.clone());

        if let Some(price) = current_prices.get(asset.clone()) {
            let target_balance = value_to_balance(target_value, price, asset_decimals);
            let trade_amount = target_balance - current_balance;

            if trade_amount.abs() > MIN_TRADE_AMOUNT_STROOPS {
                trades.set(asset, trade_amount);
            }
        }
    }

    trades
}

pub fn build_rebalance_preview(
    env: &Env,
    portfolio: &Portfolio,
    reflector_client: &crate::reflector::ReflectorClient,
) -> Result<RebalancePreview, Error> {
    let current_time = env.ledger().timestamp();
    let mut candidate_trades = Map::new(env);
    let mut skipped_assets = Vec::new(env);
    let mut skip_reasons = Map::new(env);
    let mut threshold_decisions = Map::new(env);
    let mut rebalance_needed = false;

    let total_value = match calculate_portfolio_value(
        env,
        &portfolio.current_balances,
        &portfolio.asset_decimals,
        reflector_client,
    ) {
        Some(value) if value > 0 => value,
        Some(_) => {
            return Ok(RebalancePreview {
                candidate_trades,
                skipped_assets,
                skip_reasons,
                threshold_decisions,
                rebalance_needed: false,
                total_value: 0,
            });
        }
        None => return Err(Error::PreviewUnavailable),
    };

    let mut current_prices = Map::new(env);
    for (asset, _) in portfolio.target_allocations.iter() {
        if let Some(price_data) =
            reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
        {
            if price_data.is_stale(current_time, 3600) {
                skipped_assets.push_back(asset.clone());
                skip_reasons.set(asset.clone(), AssetSkipReason::StalePrice);
                continue;
            }
            current_prices.set(asset.clone(), price_data.price);
        } else {
            skipped_assets.push_back(asset.clone());
            skip_reasons.set(asset.clone(), AssetSkipReason::MissingPrice);
        }
    }

    for (asset, target_percent) in portfolio.target_allocations.iter() {
        if skip_reasons.contains_key(asset.clone()) {
            continue;
        }

        let price = current_prices.get(asset.clone()).unwrap();
        let current_balance = portfolio.current_balances.get(asset.clone()).unwrap_or(0);
        let current_asset_value = balance_to_value(current_balance, price);
        let current_percent_u32 = ((current_asset_value * 100) / total_value) as u32;
        let drift = if current_percent_u32 >= target_percent {
            current_percent_u32 - target_percent
        } else {
            target_percent - current_percent_u32
        };
        let exceeds_threshold = drift > portfolio.rebalance_threshold;
        if exceeds_threshold {
            rebalance_needed = true;
        }

        threshold_decisions.set(
            asset.clone(),
            ThresholdDecision {
                current_percent: current_percent_u32,
                target_percent,
                drift,
                exceeds_threshold,
            },
        );

        let target_value = (total_value * target_percent as i128) / 100;
        let asset_decimals = asset_decimals_for(portfolio, asset.clone());
        let target_balance = value_to_balance(target_value, price, asset_decimals);
        let trade_amount = target_balance - current_balance;

        if trade_amount.abs() <= MIN_TRADE_AMOUNT_STROOPS {
            skipped_assets.push_back(asset.clone());
            skip_reasons.set(asset.clone(), AssetSkipReason::BelowMinTrade);
        } else if !exceeds_threshold {
            skipped_assets.push_back(asset.clone());
            skip_reasons.set(asset.clone(), AssetSkipReason::WithinThreshold);
        } else {
            candidate_trades.set(asset.clone(), trade_amount);
        }
    }

    Ok(RebalancePreview {
        candidate_trades,
        skipped_assets,
        skip_reasons,
        threshold_decisions,
        rebalance_needed,
        total_value,
    })
}
