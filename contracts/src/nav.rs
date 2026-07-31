use crate::portfolio::calculate_portfolio_value;
use crate::reflector::ReflectorClient;
use crate::types::{DataKey, Error, NavSnapshot, Portfolio};
use soroban_sdk::{symbol_short, Env, Symbol, Vec};

pub const MAX_NAV_SNAPSHOTS: u32 = 100;

pub fn snapshot_nav(env: &Env, portfolio_id: u64) -> Result<NavSnapshot, Error> {
    let portfolio_key = DataKey::Portfolio(portfolio_id);
    let portfolio: Portfolio = env
        .storage()
        .persistent()
        .get(&portfolio_key)
        .ok_or(Error::PortfolioNotFound)?;

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

pub fn save_nav_snapshot(
    env: &Env,
    portfolio_id: u64,
    snapshot: &NavSnapshot,
) -> Result<(), Error> {
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
        (symbol_short!("portfolio"), Symbol::new(env, "nav_snapshot")),
        (
            portfolio_id,
            snapshot.usd_nav,
            snapshot.sequence,
            snapshot.timestamp,
        ),
    );

    Ok(())
}

pub fn get_nav_history(
    env: &Env,
    portfolio_id: u64,
    limit: u32,
) -> Result<Vec<NavSnapshot>, Error> {
    let portfolio_key = DataKey::Portfolio(portfolio_id);
    if !env.storage().persistent().has(&portfolio_key) {
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
