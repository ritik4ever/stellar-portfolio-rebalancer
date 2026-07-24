use crate::types::*;
use soroban_sdk::{symbol_short, Address, Env, Map, String, Symbol, Vec};

/// Loads the registry of known template names, defaulting to an empty vec.
fn load_template_names(env: &Env) -> Vec<String> {
    env.storage()
        .persistent()
        .get(&DataKey::TemplateNames)
        .unwrap_or(Vec::new(env))
}

fn require_admin(env: &Env) -> Address {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    admin.require_auth();
    admin
}

fn validate_template_allocations(allocations: &Map<Address, u32>) -> bool {
    crate::portfolio::validate_allocations(allocations)
}

fn emit_template_created(env: &Env, name: &String) {
    env.events().publish(
        (symbol_short!("template"), Symbol::new(env, "created")),
        name.clone(),
    );
}

fn emit_template_updated(env: &Env, name: &String) {
    env.events().publish(
        (symbol_short!("template"), Symbol::new(env, "updated")),
        name.clone(),
    );
}

/// Admin-only: create a new named on-chain allocation template.
///
/// Fails with [`Error::TemplateAlreadyExists`] if a template with this name
/// already exists (use `update_template` to change it instead), and with
/// [`Error::InvalidAllocation`] if the allocations don't sum to exactly
/// [`ALLOCATION_DENOMINATOR`] (10 000 bps).
pub fn create_template(env: &Env, name: String, allocations: Map<Address, u32>) -> Result<(), Error> {
    require_admin(env);

    if !validate_template_allocations(&allocations) {
        return Err(Error::InvalidAllocation);
    }

    let key = DataKey::Template(name.clone());
    if env.storage().persistent().has(&key) {
        return Err(Error::TemplateAlreadyExists);
    }

    env.storage().persistent().set(&key, &allocations);

    let mut names = load_template_names(env);
    names.push_back(name.clone());
    env.storage()
        .persistent()
        .set(&DataKey::TemplateNames, &names);

    emit_template_created(env, &name);
    Ok(())
}

/// Admin-only: update the allocations of an existing named template.
pub fn update_template(env: &Env, name: String, allocations: Map<Address, u32>) -> Result<(), Error> {
    require_admin(env);

    if !validate_template_allocations(&allocations) {
        return Err(Error::InvalidAllocation);
    }

    let key = DataKey::Template(name.clone());
    if !env.storage().persistent().has(&key) {
        return Err(Error::TemplateNotFound);
    }

    env.storage().persistent().set(&key, &allocations);
    emit_template_updated(env, &name);
    Ok(())
}

/// Public view: fetch a template's stored allocations, if it exists.
pub fn get_template(env: &Env, name: String) -> Option<Map<Address, u32>> {
    env.storage().persistent().get(&DataKey::Template(name))
}

/// Public view: list the names of all known templates, in creation order.
pub fn list_templates(env: &Env) -> Vec<String> {
    load_template_names(env)
}
