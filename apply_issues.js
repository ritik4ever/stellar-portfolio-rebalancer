const fs = require('fs');

// 1. Patch types.rs
let types = fs.readFileSync('contracts/src/types.rs', 'utf8').replace(/\r\n/g, '\n');

// types.rs: Portfolio struct
types = types.replace(
    "pub asset_decimals: Map<Address, u32>,\n    pub rebalance_threshold: u32,",
    "pub asset_decimals: Map<Address, u32>,\n    pub asset_thresholds: Map<Address, u32>,\n    pub rebalance_threshold: u32,"
);

// types.rs: CircuitBreakerConfig struct
types = types.replace(
    "pub struct UpgradeEvent {\n    pub from_hash: BytesN<32>,\n    pub to_hash: BytesN<32>,\n    pub timestamp: u64,\n}",
    "pub struct UpgradeEvent {\n    pub from_hash: BytesN<32>,\n    pub to_hash: BytesN<32>,\n    pub timestamp: u64,\n}\n\n#[contracttype]\n#[derive(Clone, Debug, Eq, PartialEq)]\npub struct CircuitBreakerConfig {\n    pub window_seconds: u64,\n    pub spike_threshold_bps: u32,\n}"
);

// types.rs: DataKey enum
types = types.replace(
    "SupportedAssets,",
    "SupportedAssets,\n    MaxPriceAgeSeconds,\n    CircuitBreakerConfig,"
);
types = types.replace("Initialized,", "");

// types.rs: Error enum
types = types.replace(
    "InvalidWithdrawAmount = 25,",
    "InvalidWithdrawAmount = 25,\n    StaleOraclePrice = 26,\n    InvalidAssetThreshold = 27,"
);
types = types.replace("AlreadyInitialized = 7,", "AlreadyInitialized = 7,");

fs.writeFileSync('contracts/src/types.rs', types);


// 2. Patch lib.rs
let lib = fs.readFileSync('contracts/src/lib.rs', 'utf8').replace(/\r\n/g, '\n');

// lib.rs: mod circuit_breaker
lib = lib.replace("mod reflector;", "mod reflector;\nmod circuit_breaker;");

// lib.rs: Double init
lib = lib.replace(
    "if env.storage().instance().has(&DataKey::Initialized) {",
    "if env.storage().instance().has(&DataKey::Admin) {"
);
lib = lib.replace(
    "env.storage().instance().set(&DataKey::Initialized, &true);",
    ""
);

// lib.rs: create_portfolio signature
lib = lib.replace(
    "target_allocations: Map<Address, u32>,\n        asset_decimals: Map<Address, u32>,\n        rebalance_threshold: u32,",
    "target_allocations: Map<Address, u32>,\n        asset_decimals: Map<Address, u32>,\n        asset_thresholds: Map<Address, u32>,\n        rebalance_threshold: u32,"
);

// lib.rs: create_portfolio body
lib = lib.replace(
    "current_balances: Map::new(&env),\n            asset_decimals,\n            rebalance_threshold,",
    "current_balances: Map::new(&env),\n            asset_decimals,\n            asset_thresholds,\n            rebalance_threshold,"
);

// lib.rs: create_portfolio validation
lib = lib.replace(
    "if !(MIN_REBALANCE_THRESHOLD..=MAX_REBALANCE_THRESHOLD).contains(&rebalance_threshold) {\n            return Err(Error::InvalidThreshold);\n        }",
    "if !(MIN_REBALANCE_THRESHOLD..=MAX_REBALANCE_THRESHOLD).contains(&rebalance_threshold) {\n            return Err(Error::InvalidThreshold);\n        }\n\n        for (_, threshold) in asset_thresholds.iter() {\n            if !(MIN_REBALANCE_THRESHOLD..=MAX_REBALANCE_THRESHOLD).contains(&threshold) {\n                return Err(Error::InvalidAssetThreshold);\n            }\n        }"
);

// lib.rs: execute_rebalance_internal stale price + circuit breaker
const old_exec = `        let mut current_prices = Map::new(&env);
        for (asset, _) in portfolio.target_allocations.iter() {
            if let Some(price_data) =
                reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
            {
                current_prices.set(asset.clone(), price_data.price);
            } else {
                return Err(Error::MissingPrice);
            }
        }`;
const new_exec = `        let max_price_age = Self::get_max_price_age(env.clone());
        let mut current_prices = Map::new(&env);
        let current_time = guard_ledger_timestamp(&env);
        for (asset, _) in portfolio.target_allocations.iter() {
            if let Some(price_data) =
                reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
            {
                if current_time > price_data.timestamp + max_price_age {
                    return Err(Error::StaleOraclePrice);
                }
                current_prices.set(asset.clone(), price_data.price);
            } else {
                return Err(Error::MissingPrice);
            }
        }

        let cb_config = Self::get_circuit_breaker_config(env.clone());
        circuit_breaker::check_volatility(env.clone(), &cb_config, &reflector_client, &current_prices)?;`;
lib = lib.replace(old_exec, new_exec);

// lib.rs: get/set max_price_age and cb_config
const impl_end = `        portfolio::emit_portfolio_rebalanced(env, portfolio_id, current_time);
        Ok(())
    }
}`;
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
}`;
lib = lib.replace(impl_end, impl_end_new);

fs.writeFileSync('contracts/src/lib.rs', lib);


// 3. Patch portfolio.rs
let port = fs.readFileSync('contracts/src/portfolio.rs', 'utf8').replace(/\r\n/g, '\n');

const drift_old = `        let drift = if current_percent > target_percent {
            current_percent - target_percent
        } else {
            target_percent - current_percent
        };

        let exceeds_threshold = drift > portfolio.rebalance_threshold;`;
const drift_new = `        let drift = if current_percent > target_percent {
            current_percent - target_percent
        } else {
            target_percent - current_percent
        };

        let active_threshold = portfolio.asset_thresholds.get(asset.clone()).unwrap_or(portfolio.rebalance_threshold);
        let exceeds_threshold = drift > active_threshold;`;
port = port.replace(drift_old, drift_new);

fs.writeFileSync('contracts/src/portfolio.rs', port);


// 4. Patch test.rs
let test = fs.readFileSync('contracts/src/test.rs', 'utf8').replace(/\r\n/g, '\n');

const test_create = `    let asset_decimals = allocation_decimals(env, allocations, DEFAULT_ASSET_DECIMALS);
    client.create_portfolio(
        user,
        allocations,
        &asset_decimals,
        &rebalance_threshold,`;
const test_create_new = `    let asset_decimals = allocation_decimals(env, allocations, DEFAULT_ASSET_DECIMALS);
    let asset_thresholds = Map::new(env);
    client.create_portfolio(
        user,
        allocations,
        &asset_decimals,
        &asset_thresholds,
        &rebalance_threshold,`;
test = test.replace(test_create, test_create_new);

// Add test_double_initialize_fails
const test_deposit = `#[test]
fn test_deposit_valid() {`;
const test_deposit_new = `#[test]
#[should_panic(expected = "Error(Contract, 7)")]
fn test_double_initialize_fails() {
    let env = Env::default();
    let contract_id = env.register_contract(None, PortfolioRebalancer);
    let client = PortfolioRebalancerClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let reflector_id = Address::generate(&env);

    client.initialize(&admin1, &reflector_id);
    client.initialize(&admin2, &reflector_id);
}

#[test]
fn test_deposit_valid() {`;
test = test.replace(test_deposit, test_deposit_new);

fs.writeFileSync('contracts/src/test.rs', test);
