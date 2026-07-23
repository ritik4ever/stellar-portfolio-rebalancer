use soroban_sdk::{symbol_short, Address, Env, Symbol};

pub fn emit_recurring_deposit_scheduled(
    env: &Env,
    portfolio_id: u64,
    amount: i128,
    asset: Address,
    interval_seconds: u64,
) {
    env.events().publish(
        (
            symbol_short!("portfolio"),
            Symbol::new(env, "recurring_deposit_scheduled"),
        ),
        (portfolio_id, amount, asset, interval_seconds),
    );
}

pub fn emit_recurring_deposit_cancelled(env: &Env, portfolio_id: u64) {
    env.events().publish(
        (
            symbol_short!("portfolio"),
            Symbol::new(env, "recurring_deposit_cancelled"),
        ),
        (portfolio_id,),
    );
}

pub fn emit_recurring_deposit_executed(
    env: &Env,
    portfolio_id: u64,
    amount: i128,
    asset: Address,
    timestamp: u64,
    rebalance_triggered: bool,
) {
    env.events().publish(
        (
            symbol_short!("portfolio"),
            Symbol::new(env, "recurring_deposit_executed"),
        ),
        (portfolio_id, amount, asset, timestamp, rebalance_triggered),
    );
}
