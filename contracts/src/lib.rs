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
    fn allocate_portfolio_id(env: &Env) -> u64 {
        let portfolio_id = Self::allocate_portfolio_id(&env);
        portfolio_id
    }
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
        rebalance_threshold: u32,
        slippage_tolerance: u32,
    ) -> Result<u64, Error> {
        user.require_auth();

        if !portfolio::validate_allocations(&target_allocations) {
            return Err(Error::InvalidAllocation);
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
            rebalance_threshold,
            slippage_tolerance,
            last_rebalance: env.ledger().timestamp(),
            total_value: 0,
            is_active: true,
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

    pub fn deposit(env: Env, portfolio_id: u64, asset: Address, amount: i128, memo: String) {
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

        portfolio.user.require_auth();

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

        // Calculate total current value
        let total_value = match portfolio::calculate_portfolio_value(
            &env,
            &portfolio.current_balances,
            &reflector_client,
        ) {
            Some(val) => val,
            None => return false, // Cannot safely rebalance without all prices
        };

        if total_value == 0 {
            return false;
        }

        // Check drift for each asset
        for (asset, target_percent) in portfolio.target_allocations.iter() {
            let current_balance = portfolio.current_balances.get(asset.clone()).unwrap_or(0);

            // Get price from reflector
            // Note: In a real app we'd need to handle potential failures/missing prices gracefully
            // For this check, if price missing, we can't calculate drift, so maybe skip or fail?
            // Let's skip for simplicity in this check
            if let Some(price_data) =
                reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
            {
                let current_asset_value = (current_balance * price_data.price) / 10i128.pow(14);
                let current_percent = (current_asset_value * 100) / total_value;

                 let drift = (current_percent - target_percent as i128).abs();
                if drift > portfolio.rebalance_threshold as i128 {
                    return true;
                }
            }
        }

        false
    }

    pub fn execute_rebalance(env: Env, portfolio_id: u64, actual_balances: Map<Address, i128>) -> Result<(), Error> {
        if let Some(true) = env.storage().instance().get(&DataKey::EmergencyStop) {
            panic!("Emergency stop active");
        }

        let mut portfolio: Portfolio = env
            .storage()
            .persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap();

        portfolio.user.require_auth();

        let current_time = env.ledger().timestamp();
        if current_time < portfolio.last_rebalance + 3600 {
            panic!("Cooldown active");
        }

        let reflector_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::ReflectorAddress)
            .unwrap();
        let reflector_client = ReflectorClient::new(&env, &reflector_address);

        for (asset, _) in portfolio.target_allocations.iter() {
            if let Some(price_data) =
                reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
            {
                if price_data.is_stale(current_time, 3600) {
                    panic!("Stale price data");
                }
            } else {
                panic!("Missing price data");
            }
        }

        let total_value = portfolio::calculate_portfolio_value(
            &env,
            &portfolio.current_balances,
            &reflector_client,
        ).unwrap();

        let mut has_actual_balances = false;
        for (_, _) in actual_balances.iter() {
            has_actual_balances = true;
            break;
        }
        if has_actual_balances && total_value > 0 {
            for (asset, target_pct) in portfolio.target_allocations.iter() {
                let price_data = reflector_client
                    .lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
                    .unwrap();
                let price = price_data.price;
                let expected_value = (total_value * target_pct as i128) / 100;
                let expected_balance = (expected_value * 10i128.pow(14)) / price;
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
                    if slippage_bps > portfolio.slippage_tolerance as i128 {
                        return Err(Error::SlippageExceeded);
                    }
                }
            }
        }

        let fee_config: FeeConfig = env
            .storage()
            .instance()
            .get(&DataKey::FeeConfig)
            .unwrap_or(FeeConfig {
                fee_bps: 0,
                fee_recipient: env.current_contract_address(),
                enabled: false,
            });
        if fee_config.enabled && total_value > 0 {
            let total_fee = total_value * fee_config.fee_bps as i128 / 10000;
            if total_fee > 0 {
                env.events().publish(
                    ("portfolio", "fee_charged"),
                    (portfolio_id, fee_config.fee_recipient.clone(), total_fee),
                );
            }
        }

        portfolio.last_rebalance = current_time;
        env.storage()
            .persistent()
            .set(&DataKey::Portfolio(portfolio_id), &portfolio);

        env.events()
            .publish(("portfolio", "rebalanced"), (portfolio_id, current_time));
        Ok(())
    }

    /// Non-mutating simulation path for backend dry-run APIs.
    /// Returns a map of planned trades (asset -> amount) where positive = buy, negative = sell.
    /// Performs the same policy checks as `execute_rebalance` but does not update storage.
    pub fn simulate_rebalance(
        env: Env,
        portfolio_id: u64,
        actual_balances: Map<Address, i128>,
    ) -> Result<Map<Address, i128>, Error> {
        if let Some(true) = env.storage().instance().get(&DataKey::EmergencyStop) {
            return Err(Error::EmergencyStop);
        }

        let portfolio: Portfolio = env
            .storage()
            .persistent()
            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap();

        let current_time = env.ledger().timestamp();
        // Surface cooldown as a policy failure instead of mutating state
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
                    return Err(Error::StaleData);
                }
                current_prices.set(asset.clone(), price_data.price);
            } else {
                return Err(Error::StaleData);
            }
        }

        // Compute total value using live prices; propagate failures as policy errors.
        let total_value = match portfolio::calculate_portfolio_value(&env, &portfolio.current_balances, &reflector_client) {
            Some(v) => v,
            None => return Err(Error::StaleData),
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
            if total_value > 0 {
                for (asset, target_pct) in snapshot.target_allocations.iter() {
                    let price = current_prices.get(asset.clone()).unwrap();
                    let expected_value = (total_value * target_pct as i128) / 100;
                    let expected_balance = (expected_value * 10i128.pow(14)) / price;
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

        Ok(trades)
    }

    pub fn set_emergency_stop(env: Env, stop: bool) {
        require_admin(&env);
        env.storage().instance().set(&DataKey::EmergencyStop, &stop);
    }

    pub fn set_fee_config(env: Env, config: FeeConfig) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        if config.enabled && config.fee_bps > 1000 {
            panic!("Fee exceeds maximum allowed (1000 bps = 10%)");
        }
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
}

fn require_admin(env: &Env) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    admin.require_auth();
}
