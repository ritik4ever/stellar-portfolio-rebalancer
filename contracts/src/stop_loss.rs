use soroban_sdk::{Address, Env, Map, Symbol, Vec};
use crate::reflector::ReflectorClient;
use crate::types::*;

pub fn set_stop_loss(
    env: &Env,
    portfolio_id: u64,
    asset: Address,
    price: i128,
) -> Result<(), Error> {
    let portfolio = super::PortfolioRebalancer::load_portfolio(env, portfolio_id)?;
    let steward = env
        .storage()
        .persistent()
        .get(&DataKey::Steward(portfolio_id))
        .unwrap_or(portfolio.user.clone());
    steward.require_auth();

    env.storage()
        .persistent()
        .set(&DataKey::StopLoss(portfolio_id, asset.clone()), &price);

    env.events().publish(
        (Symbol::new(env, "stop_loss"), Symbol::new(env, "set")),
        (portfolio_id, asset, price),
    );
    Ok(())
}

pub fn remove_stop_loss(
    env: &Env,
    portfolio_id: u64,
    asset: Address,
) -> Result<(), Error> {
    let portfolio = super::PortfolioRebalancer::load_portfolio(env, portfolio_id)?;
    let steward = env
        .storage()
        .persistent()
        .get(&DataKey::Steward(portfolio_id))
        .unwrap_or(portfolio.user.clone());
    steward.require_auth();

    env.storage()
        .persistent()
        .remove(&DataKey::StopLoss(portfolio_id, asset.clone()));

    env.events().publish(
        (Symbol::new(env, "stop_loss"), Symbol::new(env, "removed")),
        (portfolio_id, asset),
    );
    Ok(())
}

pub fn get_stop_loss(
    env: &Env,
    portfolio_id: u64,
    asset: Address,
) -> Option<i128> {
    env.storage()
        .persistent()
        .get(&DataKey::StopLoss(portfolio_id, asset))
}

pub fn check_stop_losses(
    env: &Env,
    portfolio_id: u64,
    portfolio: &Portfolio,
    reflector_client: &ReflectorClient,
) -> Vec<(Address, i128)> {
    let mut triggered: Vec<(Address, i128)> = Vec::new(env);

    for (asset, _) in portfolio.target_allocations.iter() {
        if let Some(stop_loss_price) = get_stop_loss(env, portfolio_id, asset.clone()) {
            if let Some(price_data) =
                reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
            {
                if price_data.price < stop_loss_price {
                    triggered.push_back((asset.clone(), price_data.price));
                }
            }
        }
    }

    triggered
}

pub fn apply_stop_loss_adjustments(
    _env: &Env,
    triggered: &Vec<(Address, i128)>,
    target_allocations: &Map<Address, u32>,
) -> Map<Address, u32> {
    let mut adjusted = target_allocations.clone();
    let mut freed_allocation: u32 = 0;

    for (asset, _) in triggered.iter() {
        let target = adjusted.get(asset.clone()).unwrap_or(0);
        if target > 0 {
            freed_allocation += target;
            adjusted.set(asset.clone(), 0);
        }
    }

    if freed_allocation > 0 {
        let mut remaining_total: u32 = 0;
        for (_, pct) in adjusted.iter() {
            if pct > 0 {
                remaining_total += pct;
            }
        }

        if remaining_total > 0 {
            let mut distributed: u32 = 0;
            let mut last_asset: Option<Address> = None;

            for (asset, pct) in adjusted.iter() {
                if pct > 0 {
                    let extra = (freed_allocation * pct) / remaining_total;
                    adjusted.set(asset.clone(), pct + extra);
                    distributed += extra;
                    last_asset = Some(asset.clone());
                }
            }

            let remainder = freed_allocation - distributed;
            if remainder > 0 {
                if let Some(last) = last_asset {
                    let current = adjusted.get(last.clone()).unwrap_or(0);
                    adjusted.set(last, current + remainder);
                }
            }
        }
    }

    adjusted
}

pub fn emit_stop_loss_triggered(
    env: &Env,
    portfolio_id: u64,
    asset: Address,
    current_price: i128,
) {
    env.events().publish(
        (Symbol::new(env, "stop_loss"), Symbol::new(env, "triggered")),
        (portfolio_id, asset, current_price),
    );
}
