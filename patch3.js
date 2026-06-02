const fs = require('fs');

let content = fs.readFileSync('contracts/src/lib.rs', 'utf8').replace(/\r\n/g, '\n');

// 1. Add mod circuit_breaker
content = content.replace("mod reflector;", "mod reflector;\nmod circuit_breaker;");

// 2. Fix double init
content = content.replace("has(&DataKey::Initialized)", "has(&DataKey::Admin)");

// 3. Fix create_portfolio
const create_portfolio_old = `    pub fn create_portfolio(
        env: Env,
        user: Address,
        target_allocations: Map<Address, u32>,
        asset_decimals: Map<Address, u32>,
        rebalance_threshold: u32,
        slippage_tolerance: u32,
        slippage_policy_version: u32,
    ) -> Result<u64, Error> {`;
const create_portfolio_new = `    pub fn create_portfolio(
        env: Env,
        user: Address,
        target_allocations: Map<Address, u32>,
        asset_decimals: Map<Address, u32>,
        asset_thresholds: Map<Address, u32>,
        rebalance_threshold: u32,
        slippage_tolerance: u32,
        slippage_policy_version: u32,
    ) -> Result<u64, Error> {`;
content = content.replace(create_portfolio_old, create_portfolio_new);

// 4. Fix create_portfolio validation
const threshold_old = `        if !(MIN_REBALANCE_THRESHOLD..=MAX_REBALANCE_THRESHOLD).contains(&rebalance_threshold) {
            return Err(Error::InvalidThreshold);
        }`;
const threshold_new = `        if !(MIN_REBALANCE_THRESHOLD..=MAX_REBALANCE_THRESHOLD).contains(&rebalance_threshold) {
            return Err(Error::InvalidThreshold);
        }

        for (_, threshold) in asset_thresholds.iter() {
            if !(MIN_REBALANCE_THRESHOLD..=MAX_REBALANCE_THRESHOLD).contains(&threshold) {
                return Err(Error::InvalidAssetThreshold);
            }
        }`;
content = content.replace(threshold_old, threshold_new);

// 5. Fix create_portfolio struct
const portfolio_old = `            current_balances: Map::new(&env),
            asset_decimals,
            rebalance_threshold,`;
const portfolio_new = `            current_balances: Map::new(&env),
            asset_decimals,
            asset_thresholds,
            rebalance_threshold,`;
content = content.replace(portfolio_old, portfolio_new);

// 6. Fix check_rebalance_needed (syntax error)
const rebalance_needed_old = `        let total_value = match portfolio::calculate_portfolio_value(
            &env,
            &portfolio.current_balances,
            &portfolio.asset_decimals,
            &reflector_client,
        ) {
            Ok(val) => val,

        };

        if total_value == 0 {
            return false;
        }


<
            }
        }

        false
    }`;
const rebalance_needed_new = `        let total_value = match portfolio::calculate_portfolio_value(
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
    }`;
content = content.replace(rebalance_needed_old, rebalance_needed_new);

// 7. Fix transfer_steward missing variable assignment
const steward_old = `            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap();

            .storage()
            .persistent()
            .get(&DataKey::Steward(portfolio_id))`;
const steward_new = `            .get(&DataKey::Portfolio(portfolio_id))
            .unwrap();

        let current_steward: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Steward(portfolio_id))`;
content = content.replace(steward_old, steward_new);

// 8. Fix execute_rebalance
const exec_rebalance_old = `    pub fn execute_rebalance(
        env: Env,
        portfolio_id: u64,
        actual_balances: Map<Address, i128>,
    ) -> Result<(), Error> {



    pub fn admin_force_rebalance(`;
const exec_rebalance_new = `    pub fn execute_rebalance(
        env: Env,
        portfolio_id: u64,
        actual_balances: Map<Address, i128>,
    ) -> Result<(), Error> {
        Self::execute_rebalance_internal(&env, portfolio_id, actual_balances, false, None)
    }

    pub fn admin_force_rebalance(`;
content = content.replace(exec_rebalance_old, exec_rebalance_new);

// 9. Fix execute_rebalance_internal stale oracle & circuit breaker
const exec_internal_old = `        let reflector_address: Address = env
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

                }
                current_prices.set(asset.clone(), price_data.price);
            } else {

            }
        }

        let total_value = match portfolio::calculate_portfolio_value(`;
const exec_internal_new = `        let reflector_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::ReflectorAddress)
            .unwrap();
        let reflector_client = ReflectorClient::new(env, &reflector_address);

        let max_price_age = Self::get_max_price_age(env.clone());
        let mut current_prices = Map::new(&env);
        for (asset, _) in portfolio.target_allocations.iter() {
            if let Some(price_data) =
                reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
            {
                if current_time > price_data.timestamp + max_price_age {
                    return Err(Error::StaleOraclePrice);
                }
                current_prices.set(asset.clone(), price_data.price);
            } else {
                return Err(Error::StaleData);
            }
        }

        let cb_config = Self::get_circuit_breaker_config(env.clone());
        circuit_breaker::check_volatility(env, &cb_config, &reflector_client, &current_prices)?;

        let total_value = match portfolio::calculate_portfolio_value(`;
content = content.replace(exec_internal_old, exec_internal_new);


// 10. Fix execute_rebalance_internal missing match arms
const exec_old2 = `        if has_actual_balances {
            let total_value = portfolio::calculate_portfolio_value(
                env,
                &portfolio.current_balances,
                &portfolio.asset_decimals,
                &reflector_client,
            )

            if total_value > 0 {`;
const exec_new2 = `        if has_actual_balances {
            let total_value = match portfolio::calculate_portfolio_value(
                env,
                &portfolio.current_balances,
                &portfolio.asset_decimals,
                &reflector_client,
            ) {
                Ok(v) => v,
                Err(_) => return Err(Error::StaleData),
            };

            if total_value > 0 {`;
content = content.replace(exec_old2, exec_new2);


// 11. Add get_max_price_age and get_circuit_breaker_config
const impl_end_old = `        portfolio::emit_portfolio_rebalanced(env, portfolio_id, current_time);
        Ok(())
    }
}

fn require_admin(env: &Env) {`;
const impl_end_new = `        portfolio::emit_portfolio_rebalanced(env, portfolio_id, current_time);
        Ok(())
    }

    pub fn set_max_price_age(env: Env, max_age: u64) {
        require_admin(&env);
        env.storage().instance().set(&DataKey::MaxPriceAgeSeconds, &max_age);
    }

    pub fn get_max_price_age(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::MaxPriceAgeSeconds).unwrap_or(PRICE_MAX_AGE_SECONDS)
    }

    pub fn set_circuit_breaker_config(env: Env, config: CircuitBreakerConfig) {
        require_admin(&env);
        env.storage().instance().set(&DataKey::CircuitBreakerConfig, &config);
    }

    pub fn get_circuit_breaker_config(env: Env) -> CircuitBreakerConfig {
        env.storage().instance().get(&DataKey::CircuitBreakerConfig).unwrap_or(CircuitBreakerConfig {
            window_seconds: 900,
            spike_threshold_bps: 500,
        })
    }
}

fn require_admin(env: &Env) {`;
content = content.replace(impl_end_old, impl_end_new);

// 12. Fix validate_asset_decimals
const validate_old = `    for (asset, _) in allocations.iter() {
        match asset_decimals.get(asset) {
            Some(d) => {
                if d == 0 || d > MAX_ASSET_DECIMALS {
                    return false;
                }
            }
            None => return false,
        }
    }

}`;
const validate_new = `    for (asset, _) in allocations.iter() {
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
}`;
content = content.replace(validate_old, validate_new);

fs.writeFileSync('contracts/src/lib.rs', content);
