use soroban_sdk::{Env, Address, symbol_short, Symbol, Map};

pub fn emit_portfolio_created(env: &Env, invoker: &Address, portfolio_id: u64, correlation_id: u64) {
    env.events().publish(
        (symbol_short!("created"), invoker.clone(), correlation_id),
        portfolio_id,
    );
}

pub fn emit_allocation_updated(env: &Env, invoker: &Address, portfolio_id: u64, correlation_id: u64) {
    env.events().publish(
        (Symbol::new(env, "alloc_upd"), invoker.clone(), correlation_id),
        portfolio_id,
    );
}

pub fn emit_rebalance_executed(env: &Env, invoker: &Address, portfolio_id: u64, correlation_id: u64) {
    env.events().publish(
        (Symbol::new(env, "rebalanced"), invoker.clone(), correlation_id),
        portfolio_id,
    );
}

pub fn emit_circuit_breaker_triggered(env: &Env, invoker: &Address, portfolio_id: u64, correlation_id: u64) {
    env.events().publish(
        (Symbol::new(env, "cb_trip"), invoker.clone(), correlation_id),
        portfolio_id,
    );
}

pub fn emit_admin_changed(env: &Env, invoker: &Address, new_admin: &Address, correlation_id: u64) {
    env.events().publish(
        (Symbol::new(env, "admin_upd"), invoker.clone(), correlation_id),
        new_admin.clone(),
    );
}

pub fn emit_paused(env: &Env, invoker: &Address, paused: bool, correlation_id: u64) {
    env.events().publish(
        (symbol_short!("paused"), invoker.clone(), correlation_id),
        paused,
    );
}

pub fn emit_dca_executed(env: &Env, invoker: &Address, portfolio_id: u64, amount: i128, purchases: Map<Address, i128>, timestamp: u64) {
    env.events().publish(
        (Symbol::new(env, "dca_executed"), invoker.clone(), timestamp),
        (portfolio_id, amount, purchases),
    );
}

/// Step 1 of the two-step admin transfer: `current_admin` nominated
/// `pending_admin`, which does not hold any admin rights until it calls
/// `accept_admin`. Re-emitted whenever a proposal overwrites an earlier one.
pub fn emit_admin_proposed(env: &Env, current_admin: &Address, pending_admin: &Address) {
    env.events().publish(
        (Symbol::new(env, "admin_proposed"), current_admin.clone()),
        pending_admin.clone(),
    );
}

/// Step 2 of the two-step admin transfer: `new_admin` accepted the pending
/// proposal and is now the contract admin; `previous_admin` has lost all
/// admin rights as of this event.
pub fn emit_admin_transferred(env: &Env, previous_admin: &Address, new_admin: &Address) {
    env.events().publish(
        (Symbol::new(env, "admin_transferred"), previous_admin.clone()),
        new_admin.clone(),
    );
}
