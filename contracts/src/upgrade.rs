use soroban_sdk::Env;

use crate::types::{DataKey, LegacyPortfolio, Portfolio, CURRENT_STORAGE_SCHEMA_VERSION};

/// Returns the currently persisted storage schema version, or 0 if the
/// contract predates schema versioning (never migrated / freshly initialized
/// before this feature existed).
pub fn current_schema_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::SchemaVersion)
        .unwrap_or(0)
}

/// Schema-version-aware migration hook, dispatched by the stored
/// `schema_version`. Each branch below brings storage from one version to
/// the next; run them in order so a contract several versions behind catches
/// up in a single call. Idempotent — calling this when storage is already at
/// `CURRENT_STORAGE_SCHEMA_VERSION` is a no-op.
///
/// Called automatically from `execute_upgrade`, after the new WASM is
/// activated and before the upgrade is considered complete, so storage is
/// never left readable-but-stale by new contract logic.
pub fn migrate_storage(env: &Env) {
    let mut version = current_schema_version(env);
    if version >= CURRENT_STORAGE_SCHEMA_VERSION {
        return;
    }

    if version < 1 {
        migrate_v0_to_v1(env);
        version = 1;
    }

    env.storage().instance().set(&DataKey::SchemaVersion, &version);
}

/// v0 -> v1: portfolios used to be stored as `LegacyPortfolio` (no strategy
/// fields) under `DataKey::Portfolio(id)`. Reads already migrate a portfolio
/// on access (see `get_config_view`), but this sweeps any that haven't been
/// touched yet so storage is fully current right after an upgrade rather
/// than depending on incidental future reads.
fn migrate_v0_to_v1(env: &Env) {
    let next_id: u64 = env
        .storage()
        .persistent()
        .get(&DataKey::NextPortfolioId)
        .unwrap_or(1);

    for portfolio_id in 0..next_id {
        if env
            .storage()
            .persistent()
            .has(&DataKey::PortfolioV2(portfolio_id))
        {
            continue;
        }

        if let Some(legacy) = env
            .storage()
            .persistent()
            .get::<DataKey, LegacyPortfolio>(&DataKey::Portfolio(portfolio_id))
        {
            let migrated: Portfolio = legacy.into();
            env.storage()
                .persistent()
                .set(&DataKey::PortfolioV2(portfolio_id), &migrated);
            env.storage().persistent().remove(&DataKey::Portfolio(portfolio_id));
        }
    }
}
