use soroban_sdk::{Env, Address, symbol_short, Symbol};

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
