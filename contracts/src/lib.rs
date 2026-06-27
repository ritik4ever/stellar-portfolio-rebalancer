#![no_std]
#[cfg(test)]
extern crate std;

use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, Map, String};

mod portfolio;
mod reflector;
#[cfg(test)]
mod test;
mod types;

pub use reflector::*;
pub use types::*;

#[contract]
pub struct PortfolioRebalancer;

fn validate_slippage_policy_version(version: u32) -> bool {
    version == CURRENT_SLIPPAGE_POLICY_VERSION
}

fn guard_ledger_timestamp(env: &Env) -> u64 {
    let current = env.ledger().timestamp();
    let last: Option<u64> = env.storage().instance().get(&DataKey::LastTimestamp);

    if let Some(last_ts) = last {
        if current < last_ts {
            panic!("Timestamp drift: time moved backward");
        }
        if current > last_ts.saturating_add(MAX_TIMESTAMP_DRIFT_SECONDS) {
            panic!("Timestamp drift: too far in the future");
        }
    }

    env.storage()
        .instance()
        .set(&DataKey::LastTimestamp, &current);
    current
}

#[contractimpl]
impl PortfolioRebalancer {
    pub fn initialize(env: Env, admin: Address, reflector_address: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::ReflectorAddress, &reflector_address);
        env.storage().instance().set(&DataKey::EmergencyStop, &false);
        env.storage().instance().set(&DataKey::Initialized, &true);
        Ok(())
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn create_portfolio(
        env: Env,
        user: Address,
        target_allocations: Map<Address, u32>,
        asset_decimals: Map<Address, u32>,
        rebalance_threshold: u32,
        slippage_tolerance: u32,
        slippage_policy_version: u32,
    ) -> Result<u64, Error> {
        user.require_auth();

        if !portfolio::validate_allocations(&target_allocations) {
            return Err(Error::InvalidAllocation);
        }
        if !validate_asset_decimals(&target_allocations, &asset_decimals) {
            return Err(Error::InvalidAssetDecimals);
        }
        if target_allocations.len() > MAX_PORTFOLIO_ASSETS {
            return Err(Error::TooManyAssets);
        }

        if !(MIN_REBALANCE_THRESHOLD..=MAX_REBALANCE_THRESHOLD).contains(&rebalance_threshold) {
            return Err(Error::InvalidThreshold);
        }

        if !(MIN_SLIPPAGE_TOLERANCE_BPS..=MAX_SLIPPAGE_TOLERANCE_BPS).contains(&slippage_tolerance) {
            return Err(Error::InvalidSlippageTolerance);
        }

        if !validate_slippage_policy_version(slippage_policy_version) {
            return Err(Error::UnsupportedSlippagePolicyVersion);
        }

        let portfolio_id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::NextPortfolioId)
            .unwrap_or(1);
        let portfolio = Portfolio {
            user: user.clone(),
            target_allocations,
            current_balances: Map::new(&env),
            asset_decimals,
            rebalance_threshold,
            slippage_tolerance,
            slippage_policy_version,
            last_rebalance: guard_ledger_timestamp(&env),
            total_value: 0,
            is_active: true,
            pause_reason: PauseReason::None,
        };

        let _estimated_footprint =
            // portfolio::validate_portfolio_storage_footprint(&env, portfolio_id, &portfolio)?;

        env.storage()
            .persistent()
            .set(&DataKey::NextPortfolioId, &(portfolio_id + 1));
        portfolio::check_portfolio_invariants(&portfolio)?;

        env.storage()
            .persistent()
            .set(&DataKey::Portfolio(portfolio_id), &portfolio);
        portfolio::emit_portfolio_created(&env, portfolio_id, user);
        Ok(portfolio_id)
    }

    pub fn get_portfolio(env: Env, portfolio_id: u64) -> Portfolio {
        env.storage()
            .persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap()
    }

    pub fn check_invariants(env: Env, portfolio_id: u64) -> Result<(), Error> {
        let portfolio = Self::load_portfolio(&env, portfolio_id)?;
        portfolio::check_portfolio_invariants(&portfolio)
    }

    pub fn deposit(
        env: Env,
        portfolio_id: u64,
        asset: Address,
        amount: i128,
        _memo: String,
    ) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::InvalidWithdrawAmount);
        }

        if let Some(true) = env.storage().instance().get(&DataKey::EmergencyStop) {
            return Err(Error::EmergencyStop);
        }

        let mut portfolio = Self::load_portfolio(&env, portfolio_id)?;
        portfolio::check_portfolio_invariants(&portfolio)?;

        if !portfolio.is_active {
            return Err(Error::PortfolioPaused);
        }

        let steward: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Steward(portfolio_id))
            .unwrap_or(portfolio.user.clone());
        steward.require_auth();

        let current_balance = portfolio.current_balances.get(asset.clone()).unwrap_or(0);
        portfolio
            .current_balances
            .set(asset.clone(), current_balance + amount);

        env.storage()
            .persistent()
            .set(&DataKey::Portfolio(portfolio_id), &portfolio);
        portfolio::emit_portfolio_deposit(&env, portfolio_id, asset, amount);
        Ok(())
    }

    pub fn withdraw(
        env: Env,
        portfolio_id: u64,
        asset: Address,
        amount: i128,
    ) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::InvalidWithdrawAmount);
        }

        if let Some(true) = env.storage().instance().get(&DataKey::EmergencyStop) {
            return Err(Error::EmergencyStop);
        }

        let mut portfolio = Self::load_portfolio(&env, portfolio_id)?;
        portfolio.user.require_auth();
        portfolio::check_portfolio_invariants(&portfolio)?;

        let current_balance = portfolio.current_balances.get(asset.clone()).unwrap_or(0);
        if current_balance < amount {
            return Err(Error::InsufficientBalance);
        }

        let new_balance = current_balance - amount;
        if new_balance == 0 {
            portfolio.current_balances.remove(asset.clone());
        } else {
            portfolio.current_balances.set(asset.clone(), new_balance);
        }

        if !portfolio::portfolio_has_positive_balance(&portfolio) {
            portfolio.is_active = false;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Portfolio(portfolio_id), &portfolio);
        portfolio::emit_portfolio_withdraw(&env, portfolio_id, asset, amount);
        Ok(())
    }

    pub fn check_rebalance_needed(env: Env, portfolio_id: u64) -> bool {
        let portfolio: Portfolio = env
            .storage()
            .persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap();

        let reflector_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::ReflectorAddress)
            .unwrap();
        let reflector_client = ReflectorClient::new(&env, &reflector_address);

        let total_value = match portfolio::calculate_portfolio_value(
            &env,
            &portfolio.current_balances,
            &portfolio.asset_decimals,
            &reflector_client,
        ) {
            Ok(val) => val,
            Err(_) => return false,
        };

        if total_value == 0 {
            return false;
        }

        let preview = portfolio::build_rebalance_preview(&env, &portfolio, &reflector_client);
        if let Ok(p) = preview {
            p.rebalance_needed
        } else {
            false
        }
    }

    pub fn execute_rebalance(
        env: Env,
        portfolio_id: u64,
        actual_balances: Map<Address, i128>,
    ) -> Result<(), Error> {
        Self::execute_rebalance_internal(&env, portfolio_id, actual_balances, false, None)
    }

    pub fn admin_force_rebalance(
        env: Env,
        portfolio_id: u64,
        actual_balances: Map<Address, i128>,
    ) -> Result<(), Error> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        Self::execute_rebalance_internal(
            &env,
            portfolio_id,
            actual_balances,
            true,
            Some(admin),
        )
    }

    pub fn set_emergency_stop(env: Env, stop: bool) {
        require_admin(&env);
        env.storage().instance().set(&DataKey::EmergencyStop, &stop);
        let reason = if stop { PauseReason::AdminEmergency } else { PauseReason::None };
        env.storage().instance().set(&DataKey::ContractPauseReason, &reason);
    }

    pub fn transfer_stewardship(env: Env, portfolio_id: u64, new_steward: Address) -> Result<(), Error> {
        let portfolio: Portfolio = env
            .storage()
            .persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap();

        let current_steward: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Steward(portfolio_id))
            .unwrap_or(portfolio.user.clone());
        current_steward.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::Steward(portfolio_id), &new_steward);
        env.events()
            .publish(("portfolio", "steward_transferred"), (portfolio_id, current_steward, new_steward));
        Ok(())
    }

    pub fn get_steward(env: Env, portfolio_id: u64) -> Address {
        let portfolio: Portfolio = env
            .storage()
            .persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap();
        env.storage()
            .persistent()
            .get(&DataKey::Steward(portfolio_id))
            .unwrap_or(portfolio.user)
    }

    pub fn version(_env: Env) -> u32 {
        CONTRACT_VERSION
    }

    pub fn schema_version(_env: Env) -> u32 {
        CONTRACT_EVENT_SCHEMA_VERSION
    }

    pub fn capabilities(_env: Env) -> u32 {
        let mut flags: u32 = 0;
        flags |= CapabilityFlag::PerPortfolioSteward as u32;
        flags |= CapabilityFlag::DifferentiatedPricing as u32;
        flags |= CapabilityFlag::EmergencyStop as u32;
        flags
    }

    pub fn capability_summary(env: Env) -> ContractCapabilitySummary {
        ContractCapabilitySummary {
            version: Self::version(env.clone()),
            schema_version: Self::schema_version(env.clone()),
            capability_flags: Self::capabilities(env),
            min_rebalance_threshold: MIN_REBALANCE_THRESHOLD,
            max_rebalance_threshold: MAX_REBALANCE_THRESHOLD,
            min_slippage_tolerance_bps: MIN_SLIPPAGE_TOLERANCE_BPS,
            max_slippage_tolerance_bps: MAX_SLIPPAGE_TOLERANCE_BPS,
            max_portfolio_assets: MAX_PORTFOLIO_ASSETS,
        }
    }

    pub fn set_fee_config(env: Env, config: FeeConfig) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::FeeConfig, &config);
    }

    pub fn get_fee_config(env: Env) -> FeeConfig {
        env.storage()
            .instance()
            .get(&DataKey::FeeConfig)
            .unwrap_or(FeeConfig {
                fee_bps: 0,
                fee_recipient: env.current_contract_address(),
                enabled: false,
            })
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        let current_hash: Option<BytesN<32>> = env.storage().instance().get(&DataKey::WasmHash);
        env.storage()
            .instance()
            .set(&DataKey::UpgradeAuthority, &admin);
        env.deployer().update_current_contract_wasm(new_wasm_hash.clone());
        env.storage().instance().set(&DataKey::WasmHash, &new_wasm_hash);
        env.events().publish(
            ("portfolio", "upgraded"),
            UpgradeEvent {
                from_hash: current_hash.unwrap_or(BytesN::from_array(&env, &[0u8; 32])),
                to_hash: new_wasm_hash,
                timestamp: env.ledger().timestamp(),
            },
        );
    }

    /// Returns the minimum allowed rebalance threshold percentage.
    pub fn min_rebalance_threshold(_env: Env) -> u32 {
        MIN_REBALANCE_THRESHOLD
    }

    /// Returns the maximum allowed rebalance threshold percentage.
    pub fn max_rebalance_threshold(_env: Env) -> u32 {
        MAX_REBALANCE_THRESHOLD
    }

    /// Returns the minimum allowed slippage tolerance in basis points.
    pub fn min_slippage_tolerance_bps(_env: Env) -> u32 {
        MIN_SLIPPAGE_TOLERANCE_BPS
    }

    /// Returns the maximum allowed slippage tolerance in basis points.
    pub fn max_slippage_tolerance_bps(_env: Env) -> u32 {
        MAX_SLIPPAGE_TOLERANCE_BPS
    }

    /// Returns the maximum number of assets allowed in a portfolio.
    pub fn max_portfolio_assets(_env: Env) -> u32 {
        MAX_PORTFOLIO_ASSETS
    }

    pub fn preview_rebalance(env: Env, portfolio_id: u64) -> RebalancePreview {
        let portfolio: Portfolio = env
            .storage()
            .persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap();
        let reflector_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::ReflectorAddress)
            .unwrap();
        let reflector_client = ReflectorClient::new(&env, &reflector_address);
        portfolio::build_rebalance_preview(&env, &portfolio, &reflector_client)
            .unwrap_or(RebalancePreview {
                candidate_trades: Map::new(&env),
                skipped_assets: soroban_sdk::vec![&env],
                skip_reasons: Map::new(&env),
                threshold_decisions: Map::new(&env),
                rebalance_needed: false,
                total_value: 0,
            })
    }

    pub fn pause_portfolio(env: Env, portfolio_id: u64, reason: PauseReason) {
        let mut portfolio: Portfolio = env
            .storage()
            .persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap();
        portfolio.is_active = false;
        portfolio.pause_reason = reason;
        env.storage()
            .persistent()
            .set(&DataKey::Portfolio(portfolio_id), &portfolio);
    }

    pub fn get_contract_pause_reason(env: Env) -> PauseReason {
        env.storage()
            .instance()
            .get(&DataKey::ContractPauseReason)
            .unwrap_or(PauseReason::None)
    }

    fn load_portfolio(env: &Env, portfolio_id: u64) -> Result<Portfolio, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .ok_or(Error::PortfolioNotFound)
    }

    fn execute_rebalance_internal(
        env: &Env,
        portfolio_id: u64,
        actual_balances: Map<Address, i128>,
        bypass_cooldown: bool,
        override_admin: Option<Address>,
    ) -> Result<(), Error> {
        if let Some(true) = env.storage().instance().get(&DataKey::EmergencyStop) {
            return Err(Error::EmergencyStop);
        }

        let mut portfolio = Self::load_portfolio(env, portfolio_id)?;

        portfolio::check_portfolio_invariants(&portfolio)?;

        if !portfolio.is_active {
            return Err(Error::PortfolioPaused);
        }

        let steward: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Steward(portfolio_id))
            .unwrap_or(portfolio.user.clone());
        steward.require_auth();

        let current_time = guard_ledger_timestamp(env);
        if !bypass_cooldown
            && current_time < portfolio.last_rebalance.saturating_add(REBALANCE_COOLDOWN_SECONDS)
        {
            return Err(Error::CooldownActive);
        }

        let reflector_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::ReflectorAddress)
            .unwrap();
        let reflector_client = ReflectorClient::new(env, &reflector_address);

        let mut current_prices = Map::new(&env);
        for (asset, _) in portfolio.target_allocations.iter() {
            if let Some(price_data) =
                reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
            {
                current_prices.set(asset.clone(), price_data.price);
            } else {
                return Err(Error::MissingPrice);
            }
        }

        let total_value = match portfolio::calculate_portfolio_value(
            env,
            &portfolio.current_balances,
            &portfolio.asset_decimals,
            &reflector_client,
        ) {
            Ok(v) => v,
            Err(_) => return Err(Error::StaleData),
        };

        let mut snapshot = portfolio.clone();
        snapshot.total_value = total_value;

        let trades = portfolio::calculate_rebalance_trades(env, &snapshot, &current_prices);

        let mut has_actual_balances = false;
        for (_, _) in actual_balances.iter() {
            has_actual_balances = true;
            break;
        }
        if has_actual_balances {
            let total_value = match portfolio::calculate_portfolio_value(
                env,
                &portfolio.current_balances,
                &portfolio.asset_decimals,
                &reflector_client,
            ) {
                Ok(v) => v,
                Err(_) => return Err(Error::MissingPrice),
            };

            if total_value > 0 {
                for (asset, target_pct) in portfolio.target_allocations.iter() {
                    let price_data = reflector_client
                        .lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
                        .unwrap();
                    let price = price_data.price;
                    let expected_value = (total_value * target_pct as i128) / 100;
                    let decimals = portfolio.asset_decimals.get(asset.clone()).unwrap_or(DEFAULT_ASSET_DECIMALS);
                    let expected_balance =
                        portfolio::value_to_balance(expected_value, price, decimals);
                    let actual_balance = actual_balances.get(asset.clone()).unwrap_or(0);
                    let expected_abs = if expected_balance >= 0 { expected_balance } else { -expected_balance };
                    if expected_abs > 0 {
                        let diff = expected_balance - actual_balance;
                        let diff_abs = if diff >= 0 { diff } else { -diff };
                        let slippage_bps = (diff_abs * 10000) / expected_abs;
                        if slippage_bps > snapshot.slippage_tolerance as i128 {
                            return Err(Error::SlippageExceeded);
                        }
                    }
                }
            }
        }

        for (asset, amount) in trades.iter() {
            let current = portfolio.current_balances.get(asset.clone()).unwrap_or(0);
            portfolio.current_balances.set(asset.clone(), current + amount);
        }
        portfolio.total_value = total_value;
        portfolio.last_rebalance = current_time;
        env.storage()
            .persistent()
            .set(&DataKey::Portfolio(portfolio_id), &portfolio);

        if let Some(admin) = override_admin {
            portfolio::emit_cooldown_override(env, portfolio_id, admin, current_time);
        }
        portfolio::emit_portfolio_rebalanced(env, portfolio_id, current_time);
        Ok(())
    }
}

fn require_admin(env: &Env) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    admin.require_auth();
}

fn validate_asset_decimals(allocations: &Map<Address, u32>, asset_decimals: &Map<Address, u32>) -> bool {
    for (asset, _) in allocations.iter() {
        match asset_decimals.get(asset) {
            Some(d) => {
                if d == 0 || d > MAX_ASSET_DECIMALS {
                    return false;
                }
            }
            None => return false,
        }
    }
    true
}
