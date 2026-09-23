use soroban_sdk::{Env, Address, Symbol, Map};

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
