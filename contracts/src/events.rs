// events.rs - Event definitions for portfolio rebalancer

use soroban_sdk::{Address, Env, Symbol, Vec};

pub fn emit_portfolio_created(env: &Env, portfolio_id: u64, owner: Address) {
    env.events().publish(
        (Symbol::new(env, "portfolio_created"),),
        (portfolio_id, owner),
    );
}

pub fn emit_portfolio_updated(env: &Env, portfolio_id: u64, owner: Address) {
    env.events().publish(
        (Symbol::new(env, "portfolio_updated"),),
        (portfolio_id, owner),
    );
}

pub fn emit_dca_executed(env: &Env, portfolio_id: u64, invoker: Address, timestamp: u64) {
    env.events().publish(
        (Symbol::new(env, "dca_executed"),),
        (portfolio_id, invoker, timestamp),
    );
}

pub fn emit_governance_action(env: &Env, action: Symbol, signers: Vec<Address>) {
    env.events().publish(
        (Symbol::new(env, "governance_action"),),
        (action, signers),
    );
}
