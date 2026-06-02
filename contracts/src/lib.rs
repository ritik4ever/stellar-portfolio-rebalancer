#![no_std]
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

#[contractimpl]
impl PortfolioRebalancer {
    // Allocate a deterministic portfolio id from persistent storage.
    // Strategy: a monotonically increasing `NextPortfolioId` counter stored in
    // instance persistent storage. Starts at `1` and increments by one on each
    // allocation. This makes portfolio id assignment deterministic given the
    // contract state and avoids non-deterministic RNGs or timestamps.
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
        env.storage()
            .persistent()
            .set(&DataKey::NextPortfolioId, &(portfolio_id + 1));

        let portfolio = Portfolio {
            user: user.clone(),
            target_allocations,
            current_balances: Map::new(&env),
            asset_decimals,
            rebalance_threshold,
            slippage_tolerance,
            slippage_policy_version,
            last_rebalance: env.ledger().timestamp(),
            total_value: 0,
            is_active: true,
            pause_reason: PauseReason::None,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Portfolio(portfolio_id), &portfolio);
        env.events()
            .publish(("portfolio", "created"), (portfolio_id, user));
        Ok(portfolio_id)
    }

    pub fn get_portfolio(env: Env, portfolio_id: u64) -> Portfolio {
        env.storage()
            .persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap()
    }

    pub fn deposit(
        env: Env,
        portfolio_id: u64,
        asset: Address,
        amount: i128,
        memo: String,
    ) {
        if amount <= 0 {
            panic!("Amount must be positive");
        }

        if let Some(true) = env.storage().instance().get(&DataKey::EmergencyStop) {
            panic!("Emergency stop active");
        }

        let mut portfolio: Portfolio = env
            .storage()
            .persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap();

        if !portfolio.is_active {
            panic!("Portfolio paused");
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
        env.events().publish(
            ("portfolio", "deposit"),
            (portfolio_id, asset, amount, memo),
        );
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

        for (asset, target_percent) in portfolio.target_allocations.iter() {
            let current_balance = portfolio.current_balances.get(asset.clone()).unwrap_or(0);

            if let Some(price_data) =
                reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
            {
                let current_asset_value =
                    portfolio::balance_to_value(current_balance, price_data.price);
                let current_percent = (current_asset_value * 100) / total_value;

                let drift = (current_percent - target_percent as i128).abs();
                if drift > portfolio.rebalance_threshold as i128 {
                    return true;
                }
            }
        }

        false
    }

    pub fn execute_rebalance(
        env: Env,
        portfolio_id: u64,
        actual_balances: Map<Address, i128>,
    ) -> Result<(), Error> {
        if let Some(true) = env.storage().instance().get(&DataKey::EmergencyStop) {
            return Err(Error::EmergencyStop);
        }

        let mut portfolio: Portfolio = env
            .storage()
            .persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap();

        if !portfolio.is_active {
            return Err(Error::PortfolioPaused);
        }

        let steward: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Steward(portfolio_id))
            .unwrap_or(portfolio.user.clone());
        steward.require_auth();

        let current_time = env.ledger().timestamp();
        if current_time < portfolio.last_rebalance + 3600 {
            return Err(Error::CooldownActive);

        }

        let reflector_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::ReflectorAddress)
            .unwrap();
        let reflector_client = ReflectorClient::new(&env, &reflector_address);

        // Gather current prices and validate freshness. Any missing/stale price is surfaced.
        let mut current_prices = Map::new(&env);
        for (asset, _) in portfolio.target_allocations.iter() {
            if let Some(price_data) =
                reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
            {
                if price_data.is_stale(current_time, 3600) {
                    return Err(Error::StalePrice);
                }
                if price_data.price <= 0 {
                    return Err(Error::MalformedPrice);
                }
                current_prices.set(asset.clone(), price_data.price);
            } else {
                return Err(Error::MissingPrice);
            }
        }

        // Compute total value using live prices; propagate failures as policy errors.
        let total_value = match portfolio::calculate_portfolio_value(&env, &portfolio.current_balances, &portfolio.asset_decimals, &reflector_client) {
            Ok(v) => v,
            Err(_) => return Err(Error::StaleData),
        };

        // Build a temporary portfolio snapshot with computed total_value for deterministic trade planning
        let mut snapshot = portfolio.clone();
        snapshot.total_value = total_value;

        let trades = portfolio::calculate_rebalance_trades(&env, &snapshot, &current_prices);

        // If actual balances are provided, run the same slippage checks as execute_rebalance
        let mut has_actual_balances = false;
        for (_, _) in actual_balances.iter() {
            has_actual_balances = true;
            break;
        }
        if has_actual_balances {
            let total_value = portfolio::calculate_portfolio_value(
                &env,
                &portfolio.current_balances,
                &portfolio.asset_decimals,
                &reflector_client,
            ).map_err(|_| Error::StalePrice)?;
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

        // Apply computed trades to portfolio balances
        for (asset, amount) in trades.iter() {
            let current = portfolio.current_balances.get(asset.clone()).unwrap_or(0);
            portfolio.current_balances.set(asset.clone(), current + amount);
        }
        portfolio.total_value = total_value;
        portfolio.last_rebalance = current_time;
        env.storage()
            .persistent()
            .set(&DataKey::Portfolio(portfolio_id), &portfolio);

        env.events()
            .publish(("portfolio", "rebalanced"), (portfolio_id, current_time));
        Ok(())
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

    pub fn capabilities(_env: Env) -> u32 {
        let mut flags: u32 = 0;
        flags |= CapabilityFlag::PerPortfolioSteward as u32;
        flags |= CapabilityFlag::DifferentiatedPricing as u32;
        flags |= CapabilityFlag::EmergencyStop as u32;
        flags
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

fn validate_slippage_policy_version(version: u32) -> bool {
    version == SLIPPAGE_POLICY_VERSION_V1
}


