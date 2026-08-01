#![no_std]
#[cfg(test)]
extern crate std;

use soroban_sdk::{
    contract, contractimpl, symbol_short, token, Address, BytesN, Env, Map, String, Symbol, Vec,
};
use soroban_sdk::token::Client as TokenClient;

#[path = "strategies/dca.rs"]
mod dca;
mod circuit_breaker;
mod events;
mod nav;
mod oracle;
mod portfolio;
mod reflector;
mod stop_loss;
mod strategies;
#[cfg(all(test, feature = "testutils"))]
mod test;
#[cfg(all(test, feature = "testutils"))]
mod property_tests;
mod types;

pub use oracle::*;
use strategies::dca;
pub use reflector::*;
pub use types::*;
pub use events::emit_dca_executed;
pub use strategies::*;

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
    /// Validate that `reflector_address` behaves like a Reflector oracle by
    /// making a lightweight read-only call (`base()`) and checking the result.
    ///
    /// This is a best-effort guard, not a full interface conformance check:
    /// - A malicious contract could implement `base()` but return wrong data in
    ///   `lastprice()`. Further operations (rebalance, preview) will detect
    ///   missing or invalid price data at the point of use.
    /// - The goal is to fail early when the address is clearly not a Reflector
    ///   contract (e.g. a typo, an EOA, or a random contract).
    pub fn initialize(env: Env, admin: Address, reflector_address: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(Error::AlreadyInitialized);
        }

        // Lightweight validation: call base() on the provided address.
        // If the call fails (host error) or returns an unexpected type, the
        // address is not a valid Reflector oracle.
        let reflector_client = ReflectorClient::new(&env, &reflector_address);
        match reflector_client.try_base() {
            Ok(Ok(_asset)) => {}
            _ => return Err(Error::InvalidOracleAddress),
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::ReflectorAddress, &reflector_address);
        env.storage()
            .instance()
            .set(&DataKey::EmergencyStop, &false);
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
        Self::create_portfolio_with_strategy(
            env,
            user,
            target_allocations,
            asset_decimals,
            rebalance_threshold,
            slippage_tolerance,
            slippage_policy_version,
            StrategyType::Threshold,
            StrategyConfig::default(),
        )
    }

    /// Create a portfolio with full strategy configuration.
    /// `strategy` defaults to [`StrategyType::Threshold`] for callers that
    /// do not pass explicit strategy parameters (backward compatible with
    /// the original [`create_portfolio`] signature).
    pub fn create_portfolio_with_strategy(
        env: Env,
        user: Address,
        target_allocations: Map<Address, u32>,
        asset_decimals: Map<Address, u32>,
        rebalance_threshold: u32,
        slippage_tolerance: u32,
        slippage_policy_version: u32,
        strategy: StrategyType,
        strategy_config: StrategyConfig,
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

        if !portfolio::validate_slippage_policy_version(slippage_policy_version) {
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
            frozen_assets: Map::new(&env),
            rebalance_threshold,
            slippage_tolerance,
            slippage_policy_version,
            last_rebalance: guard_ledger_timestamp(&env),
            total_value: 0,
            is_active: true,
            pause_reason: PauseReason::None,
            circuit_breaker_config: CircuitBreakerConfig {
                spike_threshold_bps: DEFAULT_CIRCUIT_BREAKER_SPIKE_THRESHOLD_BPS,
                window_seconds: DEFAULT_CIRCUIT_BREAKER_WINDOW_SECONDS,
            },
            global_max_slippage_bps: DEFAULT_GLOBAL_MAX_SLIPPAGE_BPS,
            strategy,
            strategy_config,
        };

        let _estimated_footprint =
            portfolio::validate_portfolio_storage_footprint(&env, portfolio_id, &portfolio)?;


        env.storage()
            .persistent()
            .set(&DataKey::NextPortfolioId, &(portfolio_id + 1));
        portfolio::check_portfolio_invariants(&portfolio)?;

        // Store under V2 key (strategy-aware schema).
        env.storage()
            .persistent()
            .set(&DataKey::PortfolioV2(portfolio_id), &portfolio);
        portfolio::emit_portfolio_created(&env, portfolio_id, user);
        Ok(portfolio_id)
    }

    pub fn get_portfolio(env: Env, portfolio_id: u64) -> Portfolio {
        Self::load_portfolio(&env, portfolio_id).unwrap()
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

        let token_client = TokenClient::new(&env, &asset);
        token_client.transfer(&steward, &env.current_contract_address(), &amount);

        let current_balance = portfolio.current_balances.get(asset.clone()).unwrap_or(0);
        portfolio
            .current_balances
            .set(asset.clone(), current_balance + amount);

        env.storage()
            .persistent()
            .set(&DataKey::PortfolioV2(portfolio_id), &portfolio);
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

        let token_client = TokenClient::new(&env, &asset);
        token_client.transfer(&env.current_contract_address(), &portfolio.user, &amount);

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
            .set(&DataKey::PortfolioV2(portfolio_id), &portfolio);
        portfolio::emit_portfolio_withdraw(&env, portfolio_id, asset, amount);
        Ok(())
    }

    pub fn check_rebalance_needed(env: Env, portfolio_id: u64) -> bool {
        let portfolio: Portfolio = match Self::load_portfolio(&env, portfolio_id) {
            Ok(p) => p,
            Err(_) => return false,
        };

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
            if p.total_value == 0 {
                return false;
            }
            for (asset, _) in portfolio.target_allocations.iter() {
                if let Some(reason) = p.skip_reasons.get(asset) {
                    match reason {
                        AssetSkipReason::MissingPrice | AssetSkipReason::StalePrice => {
                            return false;
                        }
                        _ => {}
                    }
                }
            }
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

    pub fn batch_rebalance(
        env: Env,
        portfolio_ids: Vec<u64>,
    ) -> Result<Vec<BatchRebalanceResult>, Error> {
        if portfolio_ids.len() > MAX_BATCH_REBALANCE_PORTFOLIOS {
            return Err(Error::BatchTooLarge);
        }

        let mut results = Vec::new(&env);
        for portfolio_id in portfolio_ids.iter() {
            let result = match Self::execute_rebalance_internal(
                &env,
                portfolio_id,
                Map::new(&env),
                false,
                None,
            ) {
                Ok(()) => BatchRebalanceResultStatus::Success,
                Err(error) => BatchRebalanceResultStatus::Failed(error),
            };

            results.push_back(BatchRebalanceResult {
                portfolio_id,
                result,
            });
        }

        Ok(results)
    }

    pub fn admin_force_rebalance(
        env: Env,
        portfolio_id: u64,
        actual_balances: Map<Address, i128>,
    ) -> Result<(), Error> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        Self::execute_rebalance_internal(&env, portfolio_id, actual_balances, true, Some(admin))
    }

    pub fn set_emergency_stop(env: Env, stop: bool) {
        require_admin(&env);
        env.storage().instance().set(&DataKey::EmergencyStop, &stop);
        let reason = if stop {
            PauseReason::AdminEmergency
        } else {
            PauseReason::None
        };
        env.storage()
            .instance()
            .set(&DataKey::ContractPauseReason, &reason);
    }

    pub fn configure_dca(env: Env, portfolio_id: u64, enabled: bool, amount: i128, interval: u64) -> Result<(), Error> {
        dca::configure_dca(&env, portfolio_id, enabled, amount, interval)
    }

    pub fn execute_dca(env: Env, portfolio_id: u64) -> Result<(), Error> {
        dca::execute_dca(&env, portfolio_id)
    }

    pub fn set_stop_loss(
        env: Env,
        portfolio_id: u64,
        asset: Address,
        price: i128,
    ) -> Result<(), Error> {
        stop_loss::set_stop_loss(&env, portfolio_id, asset, price)
    }

    pub fn remove_stop_loss(
        env: Env,
        portfolio_id: u64,
        asset: Address,
    ) -> Result<(), Error> {
        stop_loss::remove_stop_loss(&env, portfolio_id, asset)
    }

    pub fn get_stop_loss(
        env: Env,
        portfolio_id: u64,
        asset: Address,
    ) -> Option<i128> {
        stop_loss::get_stop_loss(&env, portfolio_id, asset)
    }

    pub fn transfer_stewardship(
        env: Env,
        portfolio_id: u64,
        new_steward: Address,
    ) -> Result<(), Error> {
        let portfolio: Portfolio = Self::load_portfolio(&env, portfolio_id)?;

        let current_steward: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Steward(portfolio_id))
            .unwrap_or(portfolio.user.clone());
        current_steward.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::Steward(portfolio_id), &new_steward);
        env.events().publish(
            (
                symbol_short!("portfolio"),
                Symbol::new(&env, "steward_transferred"),
            ),
            (portfolio_id, current_steward, new_steward),
        );
        Ok(())
    }

    pub fn get_steward(env: Env, portfolio_id: u64) -> Address {
        let portfolio: Portfolio = Self::load_portfolio(&env, portfolio_id).unwrap();
        env.storage()
            .persistent()
            .get(&DataKey::Steward(portfolio_id))
            .unwrap_or(portfolio.user)
    }

    pub fn set_coingecko_address(env: Env, address: Address) {
        require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::CoinGeckoAddress, &address);
    }

    pub fn set_oracle_config(env: Env, config: OracleConfig) {
        require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::OracleConfig, &config);
    }

    pub fn get_oracle_config(env: Env) -> OracleConfig {
        env.storage()
            .instance()
            .get(&DataKey::OracleConfig)
            .unwrap_or(OracleConfig::default())
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


    pub fn set_circuit_breaker_config(env: Env, config: CircuitBreakerConfig) {
        require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::CircuitBreakerConfig, &config);
    }

    pub fn get_circuit_breaker_config(env: Env) -> CircuitBreakerConfig {
        env.storage()
            .instance()
            .get(&DataKey::CircuitBreakerConfig)
            .unwrap_or(CircuitBreakerConfig {
                spike_threshold_bps: 500,
                window_seconds: 3600,
            })
    }

    pub fn update_allocations(
        env: Env,
        portfolio_id: u64,
        new_allocations: Map<Address, u32>,
    ) -> Result<(), Error> {
        let mut portfolio = Self::load_portfolio(&env, portfolio_id)?;
        portfolio.user.require_auth();

        if !portfolio::validate_allocations(&new_allocations) {
            return Err(Error::InvalidAllocation);
        }

        for (asset, _) in new_allocations.iter() {
            if !portfolio.asset_decimals.contains_key(asset.clone()) {
                return Err(Error::AssetNotSupported);
            }
        }

        let old_allocations = portfolio.target_allocations.clone();
        portfolio.target_allocations = new_allocations.clone();

        portfolio::check_portfolio_invariants(&portfolio)?;

        env.storage()
            .persistent()
            .set(&DataKey::PortfolioV2(portfolio_id), &portfolio);

        env.events().publish(
            (
                symbol_short!("portfolio"),
                Symbol::new(&env, "alloc_upd"),
            ),
            (portfolio_id, old_allocations, new_allocations),
        );

        Ok(())
    }

    pub fn set_fee_config(env: Env, config: FeeConfig) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if config.fee_bps > MAX_FEE_BPS {
            panic!("fee_bps must be between 0 and 50");
        }
        
        let current_time = env.ledger().timestamp();
        let execute_after = current_time.saturating_add(TIMELOCK_DELAY_SECONDS);
        
        let queued = QueuedFeeConfig {
            config: config.clone(),
            execute_after,
        };
        
        env.storage().instance().set(&DataKey::QueuedFeeConfig, &queued);
        
        env.events().publish(
            (Symbol::new(&env, "fee_config_queued"),),
            (config, execute_after),
        );
    }

    pub fn execute_fee_config(env: Env) -> Result<(), Error> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        
        let queued: QueuedFeeConfig = env.storage()
            .instance()
            .get(&DataKey::QueuedFeeConfig)
            .ok_or(Error::PreviewUnavailable)?;
        
        let current_time = env.ledger().timestamp();
        if current_time < queued.execute_after {
            return Err(Error::TimelockNotElapsed);
        }
        
        env.storage().instance().set(&DataKey::FeeConfig, &queued.config);
        env.storage().instance().remove(&DataKey::QueuedFeeConfig);
        
        env.events().publish(
            (Symbol::new(&env, "FeeConfigUpdated"),),
            queued.config,
        );
        
        Ok(())
    }

    pub fn get_fee_config(env: Env) -> FeeConfig {
        env.storage()
            .instance()
            .get(&DataKey::FeeConfig)
            .unwrap_or(FeeConfig {
                platform_name: String::from_str(&env, ""),
                fee_bps: 0,
                fee_recipient: env.current_contract_address(),
                enabled: false,
            })
    }

    pub fn queue_upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        
        let current_time = env.ledger().timestamp();
        let execute_after = current_time.saturating_add(TIMELOCK_DELAY_SECONDS);
        
        let queued = QueuedUpgrade {
            new_wasm_hash: new_wasm_hash.clone(),
            execute_after,
        };
        
        env.storage().instance().set(&DataKey::QueuedUpgrade, &queued);
        
        env.events().publish(
            (Symbol::new(&env, "upgrade_queued"),),
            (new_wasm_hash, execute_after),
        );
    }

    pub fn execute_upgrade(env: Env) -> Result<(), Error> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        
        let queued: QueuedUpgrade = env.storage()
            .instance()
            .get(&DataKey::QueuedUpgrade)
            .ok_or(Error::PreviewUnavailable)?;
        
        let current_time = env.ledger().timestamp();
        if current_time < queued.execute_after {
            return Err(Error::TimelockNotElapsed);
        }
        
        let current_hash: Option<BytesN<32>> = env.storage().instance().get(&DataKey::WasmHash);
        env.storage()
            .instance()
            .set(&DataKey::UpgradeAuthority, &admin);
        env.deployer()
            .update_current_contract_wasm(queued.new_wasm_hash.clone());
        env.storage()
            .instance()
            .set(&DataKey::WasmHash, &queued.new_wasm_hash);
        env.storage().instance().remove(&DataKey::QueuedUpgrade);
        
        env.events().publish(
            ("portfolio", "upgraded"),
            UpgradeEvent {
                from_hash: current_hash.unwrap_or(BytesN::from_array(&env, &[0u8; 32])),
                to_hash: queued.new_wasm_hash,
                timestamp: env.ledger().timestamp(),
            },
        );
        
        Ok(())
    }

    pub fn min_rebalance_threshold(_env: Env) -> u32 {
        MIN_REBALANCE_THRESHOLD
    }

    pub fn max_rebalance_threshold(_env: Env) -> u32 {
        MAX_REBALANCE_THRESHOLD
    }

    pub fn min_slippage_tolerance_bps(_env: Env) -> u32 {
        MIN_SLIPPAGE_TOLERANCE_BPS
    }

    pub fn max_slippage_tolerance_bps(_env: Env) -> u32 {
        MAX_SLIPPAGE_TOLERANCE_BPS
    }

    pub fn max_portfolio_assets(_env: Env) -> u32 {
        MAX_PORTFOLIO_ASSETS
    }

    pub fn preview_rebalance(env: Env, portfolio_id: u64) -> RebalancePreview {
        let portfolio: Portfolio = Self::load_portfolio(&env, portfolio_id).unwrap();
        let reflector_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::ReflectorAddress)
            .unwrap();
        let reflector_client = ReflectorClient::new(&env, &reflector_address);
        portfolio::build_rebalance_preview(&env, &portfolio, &reflector_client).unwrap_or(
            RebalancePreview {
                candidate_trades: Map::new(&env),
                skipped_assets: soroban_sdk::vec![&env],
                skip_reasons: Map::new(&env),
                threshold_decisions: Map::new(&env),
                rebalance_needed: false,
                total_value: 0,
            },
        )
    }

    pub fn get_drift_preview(env: Env, portfolio_id: u64) -> Vec<AssetDrift> {
        let portfolio: Portfolio = match Self::load_portfolio(&env, portfolio_id) {
            Ok(p) => p,
            Err(_) => return Vec::new(&env),
        };

        if portfolio.target_allocations.is_empty() {
            return Vec::new(&env);
        }

        let reflector_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::ReflectorAddress)
            .unwrap();
        let reflector_client = ReflectorClient::new(&env, &reflector_address);

        let preview = match portfolio::build_rebalance_preview(&env, &portfolio, &reflector_client)
        {
            Ok(p) => p,
            Err(_) => return Vec::new(&env),
        };

        for (asset, _) in portfolio.target_allocations.iter() {
            if let Some(reason) = preview.skip_reasons.get(asset) {
                match reason {
                    AssetSkipReason::MissingPrice | AssetSkipReason::StalePrice => {
                        return Vec::new(&env);
                    }
                    _ => {}
                }
            }
        }

        if preview.total_value == 0 {
            return Vec::new(&env);
        }

        let mut result: Vec<AssetDrift> = Vec::new(&env);

        for (asset, target_pct) in portfolio.target_allocations.iter() {
            // Skip frozen assets in drift preview
            if portfolio.frozen_assets.get(asset.clone()).unwrap_or(false) {
                continue;
            }

            if let Some(decision) = preview.threshold_decisions.get(asset.clone()) {
                result.push_back(AssetDrift {
                    asset,
                    current_pct: decision.current_percent,
                    target_pct,
                    drift_pct: decision.drift,
                    needs_rebalance: decision.exceeds_threshold,
                });
            }
        }

        result
    }

    pub fn pause_portfolio(env: Env, portfolio_id: u64, reason: PauseReason) {
        let mut portfolio: Portfolio = Self::load_portfolio(&env, portfolio_id).unwrap();
        
        let steward: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Steward(portfolio_id))
            .unwrap_or(portfolio.user.clone());
        steward.require_auth();
        
        portfolio.is_active = false;
        portfolio.pause_reason = reason;
        env.storage()
            .persistent()
            .set(&DataKey::PortfolioV2(portfolio_id), &portfolio);
        
        env.events().publish(
            ("portfolio", "paused"),
            (portfolio_id, steward, reason),
        );
    }

    pub fn resume_portfolio(env: Env, portfolio_id: u64) {
        let mut portfolio: Portfolio = Self::load_portfolio(&env, portfolio_id).unwrap();
        
        let steward: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Steward(portfolio_id))
            .unwrap_or(portfolio.user.clone());
        steward.require_auth();
        
        portfolio.is_active = true;
        portfolio.pause_reason = PauseReason::None;
        env.storage()
            .persistent()
            .set(&DataKey::PortfolioV2(portfolio_id), &portfolio);
        
        env.events().publish(
            ("portfolio", "resumed"),
            (portfolio_id, steward),
        );
    }

    pub fn get_contract_pause_reason(env: Env) -> PauseReason {
        env.storage()
            .instance()
            .get(&DataKey::ContractPauseReason)
            .unwrap_or(PauseReason::None)
    }

    pub fn get_config_view(env: Env, portfolio_id: u64) -> ConfigView {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        let reflector_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::ReflectorAddress)
            .unwrap();
        let emergency_stop: bool = env
            .storage()
            .instance()
            .get(&DataKey::EmergencyStop)
            .unwrap_or(false);
        let portfolio: PortfolioOption = if let Some(p) =        env.storage()
            .persistent()
            .get(&DataKey::PortfolioV2(portfolio_id))
        {
            PortfolioOption::Some(p)
        } else if let Some(legacy) = env
            .storage()
            .persistent()
            .get::<DataKey, LegacyPortfolio>(&DataKey::Portfolio(portfolio_id))
        {
            let p: Portfolio = legacy.into();
            // Migrate on read
            env.storage()
                .persistent()
                .set(&DataKey::PortfolioV2(portfolio_id), &p);
            env.storage()
                .persistent()
                .remove(&DataKey::Portfolio(portfolio_id));
            PortfolioOption::Some(p)
        } else {
            PortfolioOption::None
        };
        ConfigView {
            admin,
            reflector_address,
            emergency_stop,
            portfolio,
        }
    }

    pub fn set_pf_circuit_breaker(
        env: Env,
        portfolio_id: u64,
        spike_threshold_bps: u32,
        window_seconds: u64,
    ) -> Result<(), Error> {
        let mut portfolio = Self::load_portfolio(&env, portfolio_id)?;
        
        portfolio.user.require_auth();
        
        portfolio.circuit_breaker_config = CircuitBreakerConfig {
            spike_threshold_bps,
            window_seconds,
        };
        
        env.storage()
            .persistent()
            .set(&DataKey::PortfolioV2(portfolio_id), &portfolio);
        
        env.events().publish(
            (Symbol::new(&env, "circuit_breaker_config_updated"),),
            (portfolio_id, spike_threshold_bps, window_seconds),
        );
        
        Ok(())
    }

    pub fn set_global_max_slippage(
        env: Env,
        portfolio_id: u64,
        global_max_slippage_bps: u32,
    ) -> Result<(), Error> {
        let mut portfolio = Self::load_portfolio(&env, portfolio_id)?;
        
        portfolio.user.require_auth();
        
        portfolio.global_max_slippage_bps = global_max_slippage_bps;
        
        env.storage()
            .persistent()
            .set(&DataKey::PortfolioV2(portfolio_id), &portfolio);
        
        env.events().publish(
            (Symbol::new(&env, "global_max_slippage_updated"),),
            (portfolio_id, global_max_slippage_bps),
        );
        
        Ok(())
    }

    pub fn set_asset_frozen(
        env: Env,
        portfolio_id: u64,
        asset: Address,
        frozen: bool,
    ) -> Result<(), Error> {
        let mut portfolio = Self::load_portfolio(&env, portfolio_id)?;
        
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        let caller_is_admin = env.auth().is_authorized(&admin);
        let caller_is_owner = env.auth().is_authorized(&portfolio.user);
        
        if !caller_is_admin && !caller_is_owner {
            return Err(Error::PortfolioNotFound);
        }
        
        // Ensure asset is part of the portfolio
        if !portfolio.target_allocations.contains_key(asset.clone()) {
            return Err(Error::AssetNotSupported);
        }
        
        if frozen {
            portfolio.frozen_assets.set(asset.clone(), true);
        } else {
            portfolio.frozen_assets.remove(asset.clone());
        }
        
        env.storage()
            .persistent()
            .set(&DataKey::Portfolio(portfolio_id), &portfolio);
        
        env.events().publish(
            (Symbol::new(&env, "asset_frozen_updated"),),
            (portfolio_id, asset, frozen),
        );
        
        Ok(())
    }

    pub fn get_portfolio_value_usd(
        env: Env,
        portfolio_id: u64,
    ) -> Result<PortfolioValuation, Error> {
        let portfolio = Self::load_portfolio(&env, portfolio_id)?;

        let reflector_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::ReflectorAddress)
            .unwrap();
        let reflector_client = ReflectorClient::new(&env, &reflector_address);

        let total_value = portfolio::calculate_portfolio_value(
            &env,
            &portfolio.current_balances,
            &portfolio.asset_decimals,
            &reflector_client,
        )?;

        let mut assets: Vec<AssetValuation> = Vec::new(&env);

        for (asset, target_pct) in portfolio.target_allocations.iter() {
            let quantity = portfolio.current_balances.get(asset.clone()).unwrap_or(0);
            let (oracle_price, usd_value) = if let Some(price_data) =
                reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
            {
                let val = portfolio::balance_to_value(quantity, price_data.price);
                (price_data.price, val)
            } else {
                (0, 0)
            };

            let current_pct = if total_value > 0 {
                ((usd_value * ALLOCATION_DENOMINATOR as i128) / total_value) as u32
            } else {
                0
            };

            let drift = current_pct as i32 - target_pct as i32;

            assets.push_back(AssetValuation {
                asset,
                quantity,
                oracle_price,
                usd_value,
                target_pct,
                current_pct,
                drift,
            });
        }

        Ok(PortfolioValuation {
            total_usd_value: total_value,
            assets,
        })
    }

    fn load_portfolio(env: &Env, portfolio_id: u64) -> Result<Portfolio, Error> {
        // Try V2 (strategy-aware) first.
        if let Some(p) = env.storage().persistent().get(&DataKey::PortfolioV2(portfolio_id)) {
            return Ok(p);
        }
        // Fall back: attempt migration from legacy (pre-strategy) storage.
        if let Some(legacy) =
            env.storage().persistent().get::<DataKey, LegacyPortfolio>(&DataKey::Portfolio(portfolio_id))
        {
            let portfolio: Portfolio = legacy.into();
            env.storage()
                .persistent()
                .set(&DataKey::PortfolioV2(portfolio_id), &portfolio);
            env.storage()
                .persistent()
                .remove(&DataKey::Portfolio(portfolio_id));
            return Ok(portfolio);
        }
        Err(Error::PortfolioNotFound)
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

        if !portfolio::validate_allocations(&portfolio.target_allocations) {
            return Err(Error::InvalidAllocationSum);
        }


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
            && current_time
                < portfolio
                    .last_rebalance
                    .saturating_add(REBALANCE_COOLDOWN_SECONDS)
        {
            return Err(Error::CooldownActive);
        }

        let reflector_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::ReflectorAddress)
            .unwrap();
        let reflector_client = ReflectorClient::new(env, &reflector_address);

        let preview = portfolio::build_rebalance_preview(env, &portfolio, &reflector_client)?;
        let triggered = stop_loss::check_stop_losses(env, portfolio_id, &portfolio, &reflector_client);
        let has_triggered = triggered.len() > 0;
        let portfolio_for_preview = if has_triggered {
            let adjusted = stop_loss::apply_stop_loss_adjustments(env, &triggered, &portfolio.target_allocations);
            for (asset, price) in triggered.iter() {
                stop_loss::emit_stop_loss_triggered(env, portfolio_id, asset.clone(), price);
            }
            let mut p = portfolio.clone();
            p.target_allocations = adjusted;
            p
        } else {
            portfolio.clone()
        };

        let preview = portfolio::build_rebalance_preview(env, &portfolio_for_preview, &reflector_client)?;

        let mut current_prices = Map::new(env);
        for (asset, _) in portfolio.target_allocations.iter() {
            if let Some(price_data) =
                reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
            {
                current_prices.set(asset, price_data.price);
            }
        }

        crate::circuit_breaker::check_volatility(
            env,
            &portfolio.circuit_breaker_config,
            &reflector_client,
            &current_prices,
        )?;

        for (asset, _) in portfolio.target_allocations.iter() {
            if let Some(reason) = preview.skip_reasons.get(asset) {
                match reason {
                    AssetSkipReason::MissingPrice => return Err(Error::MissingPrice),
                    AssetSkipReason::StalePrice => return Err(Error::StaleData),
                    _ => {}
                }
            }
        }

        let total_value = preview.total_value;
        let mut snapshot = portfolio.clone();
        snapshot.total_value = total_value;

        let trades = preview.candidate_trades;

        let fee_config = Self::get_fee_config(env.clone());
        let effective_fee_bps = if fee_config.enabled {
            fee_config.fee_bps
        } else {
            0
        };
        let fee_recipient = fee_config.fee_recipient.clone();

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
                Err(_) => return Err(Error::StaleData),

            };

            if total_value > 0 {
                let mut total_slippage_bps = 0i128;
                for (asset, target_pct) in portfolio.target_allocations.iter() {
                    let price_data = reflector_client
                        .lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
                        .unwrap();
                    let price = price_data.price;
                    let expected_value =
                        (total_value * target_pct as i128) / ALLOCATION_DENOMINATOR as i128;
                    let decimals = portfolio
                        .asset_decimals
                        .get(asset.clone())
                        .unwrap_or(DEFAULT_ASSET_DECIMALS);
                    let expected_balance =
                        portfolio::value_to_balance(expected_value, price, decimals);
                    let actual_balance = actual_balances.get(asset.clone()).unwrap_or(0);
                    let expected_abs = if expected_balance >= 0 {
                        expected_balance
                    } else {
                        -expected_balance
                    };
                    if expected_abs > 0 {
                        let diff = expected_balance - actual_balance;
                        let diff_abs = if diff >= 0 { diff } else { -diff };
                        let slippage_bps = (diff_abs * 10000) / expected_abs;
                        
                        // Per-asset slippage check (existing behavior)
                        if slippage_bps > snapshot.slippage_tolerance as i128 {
                            return Err(Error::SlippageExceeded);
                        }
                        
                        // Accumulate for global slippage check
                        total_slippage_bps += slippage_bps;
                    }
                }
                
                // Global slippage cap check across all legs
                if total_slippage_bps > portfolio.global_max_slippage_bps as i128 {
                    return Err(Error::SlippageExceeded);
                }
            }
        }

        let contract_address = env.current_contract_address();
        for (asset, amount) in trades.iter() {
            let abs_amount = amount.abs();
            let fee_amount = if effective_fee_bps > 0 {
                (abs_amount * effective_fee_bps as i128) / 10000
            } else {
                0
            };
            let effective_amount = amount - fee_amount;

            let token_client = TokenClient::new(env, &asset);
            if amount > 0 {
                token_client.transfer(&steward, &contract_address, &abs_amount);
                if fee_amount > 0 {
                    token_client.transfer(&contract_address, &fee_recipient, &fee_amount);
                }
            } else if amount < 0 {
                token_client.transfer(&contract_address, &steward, &abs_amount);
                if fee_amount > 0 {
                    token_client.transfer(&contract_address, &fee_recipient, &fee_amount);
                }
            }

            let current = portfolio.current_balances.get(asset.clone()).unwrap_or(0);
            portfolio
                .current_balances
                .set(asset.clone(), current + effective_amount);

            if fee_amount > 0 {
                let token_client = token::Client::new(env, &asset);
                token_client.transfer(
                    &env.current_contract_address(),
                    &fee_config.fee_recipient,
                    &fee_amount,
                );
                env.events().publish(
                    (Symbol::new(env, "fee_collected"), asset.clone()),
                    (fee_amount, fee_config.fee_recipient.clone(), current_time),
                );
            }
        }
        portfolio.total_value = total_value;
        portfolio.last_rebalance = current_time;
        env.storage()
            .persistent()
            .set(&DataKey::PortfolioV2(portfolio_id), &portfolio);

        if let Some(admin) = override_admin {
            portfolio::emit_cooldown_override(env, portfolio_id, admin, current_time);
        }
        portfolio::emit_portfolio_rebalanced(env, portfolio_id, current_time);

        let snapshot = NavSnapshot {
            usd_nav: total_value,
            sequence: env.ledger().sequence(),
            timestamp: current_time,
        };
        nav::save_nav_snapshot(env, portfolio_id, &snapshot)?;

        Ok(())
    }

    pub fn snapshot_nav(env: Env, portfolio_id: u64) -> Result<NavSnapshot, Error> {
        nav::snapshot_nav(&env, portfolio_id)
    }

    pub fn get_nav_history(env: Env, portfolio_id: u64, limit: u32) -> Result<Vec<NavSnapshot>, Error> {
        nav::get_nav_history(&env, portfolio_id, limit)
    }

    pub fn close_portfolio(env: Env, portfolio_id: u64) -> Result<(), Error> {
        let portfolio = Self::load_portfolio(&env, portfolio_id)?;
        
        portfolio.user.require_auth();
        
        // Sweep all asset balances to the owner
        let mut swept_amounts = Map::new(&env);
        for (asset, balance) in portfolio.current_balances.iter() {
            if balance > 0 {
                let token_client = token::Client::new(&env, &asset);
                token_client.transfer(
                    &env.current_contract_address(),
                    &portfolio.user,
                    &balance,
                );
                swept_amounts.set(asset, balance);
            }
        }
        
        // Remove portfolio storage
        // Remove portfolio storage (both legacy and V2 keys).
        env.storage()
            .persistent()
            .remove(&DataKey::Portfolio(portfolio_id));
        env.storage()
            .persistent()
            .remove(&DataKey::PortfolioV2(portfolio_id));
        
        // Remove steward if exists
        env.storage()
            .persistent()
            .remove(&DataKey::Steward(portfolio_id));
        
        // Remove DCA config if exists
        env.storage()
            .persistent()
            .remove(&DataKey::DCAConfig(portfolio_id));
        
        // Remove NAV history if exists
        env.storage()
            .persistent()
            .remove(&DataKey::NavHistory(portfolio_id));
        
        // Emit portfolio_closed event
        env.events().publish(
            (Symbol::new(&env, "portfolio_closed"),),
            (portfolio_id, portfolio.user, swept_amounts),
        );
        
        Ok(())
    }
}

fn require_admin(env: &Env) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    admin.require_auth();
}

fn validate_asset_decimals(
    allocations: &Map<Address, u32>,
    asset_decimals: &Map<Address, u32>,
) -> bool {
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
