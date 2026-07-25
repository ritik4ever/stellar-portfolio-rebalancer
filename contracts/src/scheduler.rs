// Time-locked rebalance scheduler.
//
// Portfolio owner schedules a rebalance at a future ledger sequence.
// Anyone may execute the scheduled rebalance after the target sequence.
// Owner may cancel a pending schedule. At most one pending schedule per portfolio.

use soroban_sdk::{symbol_short, Address, Env, Map, Symbol};

use crate::types::*;

/// Schedule a rebalance at a future ledger sequence.
/// Only the portfolio owner (or steward) may call.
pub fn schedule_rebalance(
    env: &Env,
    portfolio_id: u64,
    target_sequence: u32,
) -> Result<(), Error> {
    let portfolio = crate::PortfolioRebalancer::load_portfolio(env, portfolio_id)?;

    let steward: Address = env
        .storage()
        .persistent()
        .get(&DataKey::Steward(portfolio_id))
        .unwrap_or(portfolio.user.clone());
    steward.require_auth();

    // Reject past or current sequences — must be a future ledger.
    let current_sequence = env.ledger().sequence();
    if target_sequence <= current_sequence {
        return Err(Error::ScheduleNotReady);
    }

    // Ensure no existing schedule is pending
    if env
        .storage()
        .persistent()
        .has(&DataKey::ScheduleConfig(portfolio_id))
    {
        return Err(Error::ScheduleAlreadyExists);
    }

    let current_ts = env.ledger().timestamp();
    let config = ScheduleConfig {
        target_sequence,
        created_at: current_ts,
    };

    env.storage()
        .persistent()
        .set(&DataKey::ScheduleConfig(portfolio_id), &config);

    emit_rebalance_scheduled(env, portfolio_id, target_sequence, current_ts);
    Ok(())
}

/// Execute a scheduled rebalance if the target sequence has been reached.
/// Callable by anyone — no authorization required.
pub fn execute_scheduled_rebalance(
    env: &Env,
    portfolio_id: u64,
    actual_balances: Map<Address, i128>,
) -> Result<(), Error> {
    let config = env
        .storage()
        .persistent()
        .get(&DataKey::ScheduleConfig(portfolio_id))
        .ok_or(Error::NoScheduleFound)?;

    let current_sequence = env.ledger().sequence();
    if current_sequence < config.target_sequence {
        return Err(Error::ScheduleNotReady);
    }

    // Delegate to the internal rebalance execution path.
    // Bypass cooldown so the scheduled rebalance always succeeds
    // timing-wise once the sequence is reached.
    // Skip owner auth so anyone can trigger execution.
    crate::PortfolioRebalancer::execute_rebalance_internal(
        env,
        portfolio_id,
        actual_balances,
        true,  // bypass_cooldown
        None,  // no admin override
        true,  // skip_owner_auth: anyone can execute
    )?;

    // Only remove the schedule after a successful rebalance.
    env.storage()
        .persistent()
        .remove(&DataKey::ScheduleConfig(portfolio_id));

    Ok(())
}

/// Cancel a pending scheduled rebalance.
/// Only the portfolio owner (or steward) may call.
pub fn cancel_scheduled_rebalance(env: &Env, portfolio_id: u64) -> Result<(), Error> {
    let portfolio = crate::PortfolioRebalancer::load_portfolio(env, portfolio_id)?;

    let steward: Address = env
        .storage()
        .persistent()
        .get(&DataKey::Steward(portfolio_id))
        .unwrap_or(portfolio.user.clone());
    steward.require_auth();

    // Load the config so we can emit the event with details
    let config = env
        .storage()
        .persistent()
        .get(&DataKey::ScheduleConfig(portfolio_id))
        .ok_or(Error::NoScheduleFound)?;

    env.storage()
        .persistent()
        .remove(&DataKey::ScheduleConfig(portfolio_id));

    emit_rebalance_canceled(env, portfolio_id, config.target_sequence);
    Ok(())
}

/// Check if a schedule exists for a portfolio.
pub fn has_schedule(env: &Env, portfolio_id: u64) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::ScheduleConfig(portfolio_id))
}

/// Get the current schedule config for a portfolio.
pub fn get_schedule(env: &Env, portfolio_id: u64) -> Option<ScheduleConfig> {
    env.storage()
        .persistent()
        .get(&DataKey::ScheduleConfig(portfolio_id))
}

// ── Event emitters ──────────────────────────────────────────────

fn emit_rebalance_scheduled(
    env: &Env,
    portfolio_id: u64,
    target_sequence: u32,
    created_at: u64,
) {
    env.events().publish(
        (
            symbol_short!("portfolio"),
            Symbol::new(env, "rebalance_scheduled"),
        ),
        (portfolio_id, target_sequence, created_at),
    );
}

fn emit_rebalance_canceled(
    env: &Env,
    portfolio_id: u64,
    target_sequence: u32,
) {
    env.events().publish(
        (
            symbol_short!("portfolio"),
            Symbol::new(env, "rebalance_canceled"),
        ),
        (portfolio_id, target_sequence),
    );
}
