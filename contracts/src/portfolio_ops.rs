use soroban_sdk::{symbol_short, Address, Env, Map, Symbol};

use crate::{DataKey, Error, Portfolio, PortfolioRebalancer, ALLOCATION_DENOMINATOR};

const PERCENT_DENOMINATOR: i128 = 100;

pub fn split_portfolio(env: &Env, source_id: u64, pct_to_new: u32) -> Result<u64, Error> {
    if pct_to_new == 0 || pct_to_new >= 100 {
        return Err(Error::InvalidSplitPercentage);
    }
    let mut source = PortfolioRebalancer::load_portfolio(env, source_id)?;
    source.user.require_auth();
    let new_id = env
        .storage()
        .persistent()
        .get(&DataKey::NextPortfolioId)
        .unwrap_or(1);
    let mut new_portfolio = source.clone();
    let mut source_balances = Map::new(env);
    let mut new_balances = Map::new(env);
    for (asset, original_balance) in source.current_balances.iter() {
        let moved = original_balance
            .checked_mul(pct_to_new as i128)
            .ok_or(Error::ArithmeticOverflow)?
            / PERCENT_DENOMINATOR;
        let remaining = original_balance
            .checked_sub(moved)
            .ok_or(Error::ArithmeticOverflow)?;
        if remaining != 0 {
            source_balances.set(asset.clone(), remaining);
        }
        if moved != 0 {
            new_balances.set(asset, moved);
        }
    }
    let moved_value = source
        .total_value
        .checked_mul(pct_to_new as i128)
        .ok_or(Error::ArithmeticOverflow)?
        / PERCENT_DENOMINATOR;
    source.total_value = source
        .total_value
        .checked_sub(moved_value)
        .ok_or(Error::ArithmeticOverflow)?;
    source.current_balances = source_balances;
    new_portfolio.current_balances = new_balances;
    new_portfolio.total_value = moved_value;
    crate::portfolio::check_portfolio_invariants(&source)?;
    crate::portfolio::check_portfolio_invariants(&new_portfolio)?;
    crate::portfolio::validate_portfolio_storage_footprint(env, source_id, &source)?;
    crate::portfolio::validate_portfolio_storage_footprint(env, new_id, &new_portfolio)?;
    env.storage()
        .persistent()
        .set(&DataKey::PortfolioV2(source_id), &source);
    env.storage()
        .persistent()
        .set(&DataKey::PortfolioV2(new_id), &new_portfolio);
    env.storage()
        .persistent()
        .set(&DataKey::NextPortfolioId, &(new_id + 1));
    emit_split(env, source_id, new_id, pct_to_new);
    Ok(new_id)
}

pub fn merge_portfolios(env: &Env, source_id: u64, target_id: u64) -> Result<(), Error> {
    if source_id == target_id {
        return Err(Error::CannotMergeSamePortfolio);
    }
    let source = PortfolioRebalancer::load_portfolio(env, source_id)?;
    let mut target = PortfolioRebalancer::load_portfolio(env, target_id)?;
    source.user.require_auth();
    target.user.require_auth();
    if source.user != target.user {
        return Err(Error::PortfolioOwnerMismatch);
    }
    for (asset, source_balance) in source.current_balances.iter() {
        let combined = target
            .current_balances
            .get(asset.clone())
            .unwrap_or(0)
            .checked_add(source_balance)
            .ok_or(Error::ArithmeticOverflow)?;
        target.current_balances.set(asset, combined);
    }
    target.target_allocations = weighted_allocations(env, &source, &target)?;
    if target.target_allocations.len() > crate::MAX_PORTFOLIO_ASSETS {
        return Err(Error::TooManyAssets);
    }
    for (asset, decimals) in source.asset_decimals.iter() {
        if !target.asset_decimals.contains_key(asset.clone()) {
            target.asset_decimals.set(asset, decimals);
        }
    }
    target.total_value = target
        .total_value
        .checked_add(source.total_value)
        .ok_or(Error::ArithmeticOverflow)?;
    crate::portfolio::check_portfolio_invariants(&target)?;
    crate::portfolio::validate_portfolio_storage_footprint(env, target_id, &target)?;
    env.storage()
        .persistent()
        .set(&DataKey::PortfolioV2(target_id), &target);
    env.storage()
        .persistent()
        .remove(&DataKey::DCAConfig(source_id));
    env.storage()
        .persistent()
        .remove(&DataKey::NavHistory(source_id));
    env.storage()
        .persistent()
        .remove(&DataKey::Portfolio(source_id));
    env.storage()
        .persistent()
        .remove(&DataKey::PortfolioV2(source_id));
    env.storage()
        .persistent()
        .remove(&DataKey::Steward(source_id));
    emit_merge(env, source_id, target_id);
    Ok(())
}

fn weighted_allocations(
    env: &Env,
    source: &Portfolio,
    target: &Portfolio,
) -> Result<Map<Address, u32>, Error> {
    let combined_value = source
        .total_value
        .checked_add(target.total_value)
        .ok_or(Error::ArithmeticOverflow)?;
    if combined_value <= 0 {
        return Ok(target.target_allocations.clone());
    }
    let mut assets = Map::<Address, ()>::new(env);
    for (asset, _) in source.target_allocations.iter() {
        assets.set(asset, ());
    }
    for (asset, _) in target.target_allocations.iter() {
        assets.set(asset, ());
    }
    let asset_count = assets.len();
    let mut allocations = Map::new(env);
    let mut allocated = 0u32;
    for (index, (asset, ())) in assets.iter().enumerate() {
        let allocation = if index + 1 == asset_count as usize {
            ALLOCATION_DENOMINATOR - allocated
        } else {
            let source_part = (source.target_allocations.get(asset.clone()).unwrap_or(0) as i128)
                .checked_mul(source.total_value)
                .ok_or(Error::ArithmeticOverflow)?;
            let target_part = (target.target_allocations.get(asset.clone()).unwrap_or(0) as i128)
                .checked_mul(target.total_value)
                .ok_or(Error::ArithmeticOverflow)?;
            let value = source_part
                .checked_add(target_part)
                .ok_or(Error::ArithmeticOverflow)?
                / combined_value;
            u32::try_from(value).map_err(|_| Error::ArithmeticOverflow)?
        };
        allocated = allocated
            .checked_add(allocation)
            .ok_or(Error::ArithmeticOverflow)?;
        allocations.set(asset, allocation);
    }
    Ok(allocations)
}

fn emit_split(env: &Env, source_id: u64, new_id: u64, pct_to_new: u32) {
    env.events().publish(
        (symbol_short!("portfolio"), Symbol::new(env, "split")),
        (source_id, new_id, pct_to_new),
    );
}

fn emit_merge(env: &Env, source_id: u64, target_id: u64) {
    env.events().publish(
        (symbol_short!("portfolio"), Symbol::new(env, "merged")),
        (source_id, target_id),
    );
}
