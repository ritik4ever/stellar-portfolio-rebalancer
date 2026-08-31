use crate::types::{DataKey, Error, NavSnapshot, Portfolio};
use soroban_sdk::{Env, Vec, Symbol, symbol_short};
use crate::reflector::ReflectorClient;
use crate::portfolio::calculate_portfolio_value;

pub const MAX_NAV_SNAPSHOTS: u32 = 100;

pub fn snapshot_nav(env: &Env, portfolio_id: u64) -> Result<NavSnapshot, Error> {
    // Portfolios are persisted under the V2 (strategy-aware) key; fall back to
    // the legacy key for portfolios created by older contract versions.
    let portfolio: Portfolio = if let Some(p) = env
        .storage()
        .persistent()
        .get(&DataKey::PortfolioV2(portfolio_id))
    {
        p
    } else {
        env.storage()
            .persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .ok_or(Error::PortfolioNotFound)?
    };

    let reflector_address = env
        .storage()
        .instance()
        .get(&DataKey::ReflectorAddress)
        .ok_or(Error::StaleData)?;
    let reflector_client = ReflectorClient::new(env, &reflector_address);

    let total_value = calculate_portfolio_value(
        env,
        &portfolio.current_balances,
        &portfolio.asset_decimals,
        &reflector_client,
    )?;

    let snapshot = NavSnapshot {
        usd_nav: total_value,
        sequence: env.ledger().sequence(),
        timestamp: env.ledger().timestamp(),
    };

    save_nav_snapshot(env, portfolio_id, &snapshot)?;

    Ok(snapshot)
}

pub fn save_nav_snapshot(env: &Env, portfolio_id: u64, snapshot: &NavSnapshot) -> Result<(), Error> {
    let key = DataKey::NavHistory(portfolio_id);
    let mut history: Vec<NavSnapshot> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));

    history.push_back(snapshot.clone());

    if history.len() > MAX_NAV_SNAPSHOTS {
        history = history.slice(1..history.len());
    }

    env.storage().persistent().set(&key, &history);

    env.events().publish(
        (
            symbol_short!("portfolio"),
            Symbol::new(env, "nav_snapshot"),
        ),
        (portfolio_id, snapshot.usd_nav, snapshot.sequence, snapshot.timestamp),
    );

    Ok(())
}

pub fn get_nav_history(env: &Env, portfolio_id: u64, limit: u32) -> Result<Vec<NavSnapshot>, Error> {
    // Portfolios are persisted under the V2 (strategy-aware) key; also accept
    // the legacy key for portfolios created by older contract versions.
    let has_v2 = env.storage().persistent().has(&DataKey::PortfolioV2(portfolio_id));
    let has_legacy = env.storage().persistent().has(&DataKey::Portfolio(portfolio_id));
    if !has_v2 && !has_legacy {
        return Err(Error::PortfolioNotFound);
    }

    let key = DataKey::NavHistory(portfolio_id);
    let history: Vec<NavSnapshot> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));

    let len = history.len();
    if len <= limit {
        Ok(history)
    } else {
        Ok(history.slice((len - limit)..len))
    }
}
