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

/// Ensures a template's allocations can actually be turned into a portfolio
/// later: same asset-count ceiling as `create_portfolio`, and a storage
/// footprint estimate under the same limit `create_portfolio` enforces.
///
/// The footprint is estimated using a synthetic `Portfolio` value (default
/// decimals per asset, no balances yet) since templates don't carry
/// `asset_decimals` or `current_balances` themselves; this is a lower bound
/// on the real footprint at portfolio-creation time; instantiating from this
/// template can only add resource usage as balances accrue, so it is
/// conservative in the right direction against a template that is *not*
/// already unusable.
fn validate_template_size(env: &Env, allocations: &Map<Address, u32>) -> Result<(), Error> {
    if allocations.len() > MAX_PORTFOLIO_ASSETS {
        return Err(Error::TooManyAssets);
    }

    let mut asset_decimals = Map::new(env);
    for (asset, _) in allocations.iter() {
        asset_decimals.set(asset, DEFAULT_ASSET_DECIMALS);
    }

    let synthetic_portfolio = Portfolio {
        user: env.current_contract_address(),
        target_allocations: allocations.clone(),
        current_balances: Map::new(env),
        asset_decimals,
        rebalance_threshold: MIN_REBALANCE_THRESHOLD,
        slippage_tolerance: MIN_SLIPPAGE_TOLERANCE_BPS,
        slippage_policy_version: CURRENT_SLIPPAGE_POLICY_VERSION,
        last_rebalance: 0,
        total_value: 0,
        is_active: true,
        pause_reason: PauseReason::None,
    };

    crate::portfolio::validate_portfolio_storage_footprint(env, 0, &synthetic_portfolio)?;
    Ok(())
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
/// already exists (use `update_template` to change it instead), with
/// [`Error::InvalidAllocation`] if the allocations don't sum to exactly
/// [`ALLOCATION_DENOMINATOR`] (10 000 bps), with [`Error::TooManyAssets`] or
/// [`Error::PortfolioStorageFootprintTooLarge`] if the template could never
/// be turned into a portfolio, and with [`Error::TooManyTemplates`] if the
/// registry is already at [`MAX_TEMPLATES`].
pub fn create_template(env: &Env, name: String, allocations: Map<Address, u32>) -> Result<(), Error> {
    require_admin(env);

    if !validate_template_allocations(&allocations) {
        return Err(Error::InvalidAllocation);
    }
    validate_template_size(env, &allocations)?;

    let key = DataKey::Template(name.clone());
    if env.storage().persistent().has(&key) {
        return Err(Error::TemplateAlreadyExists);
    }

    let mut names = load_template_names(env);
    if names.len() >= MAX_TEMPLATES {
        return Err(Error::TooManyTemplates);
    }

    env.storage().persistent().set(&key, &allocations);

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
    validate_template_size(env, &allocations)?;

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
