const fs = require('fs');

let lib = fs.readFileSync('contracts/src/lib.rs', 'utf8').replace(/\r\n/g, '\n');

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
lib = lib.replace(rebalance_needed_old, rebalance_needed_new);

const execute_rebalance_old = `    pub fn execute_rebalance(
        env: Env,
        portfolio_id: u64,
        actual_balances: Map<Address, i128>,
    ) -> Result<(), Error> {



    pub fn admin_force_rebalance(`;
const execute_rebalance_new = `    pub fn execute_rebalance(
        env: Env,
        portfolio_id: u64,
        actual_balances: Map<Address, i128>,
    ) -> Result<(), Error> {
        Self::execute_rebalance_internal(&env, portfolio_id, actual_balances, false, None)
    }

    pub fn admin_force_rebalance(`;
lib = lib.replace(execute_rebalance_old, execute_rebalance_new);

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
lib = lib.replace(steward_old, steward_new);

const execute_internal_old1 = `        let mut current_prices = Map::new(&env);
        for (asset, _) in portfolio.target_allocations.iter() {
            if let Some(price_data) =
                reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
            {

                }
                current_prices.set(asset.clone(), price_data.price);
            } else {

            }
        }`;
const execute_internal_new1 = `        let mut current_prices = Map::new(&env);
        for (asset, _) in portfolio.target_allocations.iter() {
            if let Some(price_data) =
                reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
            {
                current_prices.set(asset.clone(), price_data.price);
            } else {
                return Err(Error::MissingPrice);
            }
        }`;
lib = lib.replace(execute_internal_old1, execute_internal_new1);

const execute_internal_old2 = `        if has_actual_balances {
            let total_value = portfolio::calculate_portfolio_value(
                env,
                &portfolio.current_balances,
                &portfolio.asset_decimals,
                &reflector_client,
            )

            if total_value > 0 {`;
const execute_internal_new2 = `        if has_actual_balances {
            let total_value = match portfolio::calculate_portfolio_value(
                env,
                &portfolio.current_balances,
                &portfolio.asset_decimals,
                &reflector_client,
            ) {
                Ok(v) => v,
                Err(_) => return Err(Error::MissingPrice),
            };

            if total_value > 0 {`;
lib = lib.replace(execute_internal_old2, execute_internal_new2);

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
lib = lib.replace(validate_old, validate_new);

fs.writeFileSync('contracts/src/lib.rs', lib);

let port = fs.readFileSync('contracts/src/portfolio.rs', 'utf8').replace(/\r\n/g, '\n');

const calc_old = `pub fn calculate_portfolio_value(
    env: &Env,
    balances: &Map<Address, i128>,
    asset_decimals: &Map<Address, u32>,
    reflector_client: &crate::reflector::ReflectorClient,

    let mut total_value = 0i128;
    let current_time = env.ledger().timestamp();

    for (asset, balance) in balances.iter() {
        let _decimals = asset_decimals
            .get(asset.clone())
            .unwrap_or(DEFAULT_ASSET_DECIMALS);
        if let Some(price_data) =
            reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset))
        {

            }
            total_value += balance_to_value(balance, price_data.price);
        } else {

        }
    }

    Ok(total_value)
}`;
const calc_new = `pub fn calculate_portfolio_value(
    env: &Env,
    balances: &Map<Address, i128>,
    asset_decimals: &Map<Address, u32>,
    reflector_client: &crate::reflector::ReflectorClient,
) -> Result<i128, Error> {
    let mut total_value = 0i128;
    let current_time = env.ledger().timestamp();

    for (asset, balance) in balances.iter() {
        let _decimals = asset_decimals
            .get(asset.clone())
            .unwrap_or(DEFAULT_ASSET_DECIMALS);
        if let Some(price_data) =
            reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset))
        {
            total_value += balance_to_value(balance, price_data.price);
        } else {
            return Err(Error::MissingPrice);
        }
    }

    Ok(total_value)
}`;
port = port.replace(calc_old, calc_new);

fs.writeFileSync('contracts/src/portfolio.rs', port);


let test = fs.readFileSync('contracts/src/test.rs', 'utf8').replace(/\r\n/g, '\n');

const test_footprint = `    assert_eq!(
        crate::portfolio::validate_portfolio_storage_footprint(&env, portfolio_id, &portfolio),
        Ok(estimate)
fn test_transfer_stewardship() {`;
const test_footprint_new = `    assert_eq!(
        crate::portfolio::validate_portfolio_storage_footprint(&env, portfolio_id, &portfolio),
        Ok(estimate)
    );
}

#[test]
fn test_transfer_stewardship() {`;
test = test.replace(test_footprint, test_footprint_new);

const test_storage = `    let _reset = ResetStorageLimit;
    crate::portfolio::set_portfolio_storage_limit_for_tests(Some(0));

fn test_create_portfolio_stores_slippage_policy_version() {`;
const test_storage_new = `    let _reset = ResetStorageLimit;
    crate::portfolio::set_portfolio_storage_limit_for_tests(Some(0));
}

#[test]
fn test_create_portfolio_stores_slippage_policy_version() {`;
test = test.replace(test_storage, test_storage_new);

const test_tolerance = `    cpu: u64,
    mem: u64,
    baseline_cpu: u64,
    baseline_mem: u64,
) {

#[test]
fn test_check_invariants_inactive_portfolio() {`;
const test_tolerance_new = `    cpu: u64,
    mem: u64,
    baseline_cpu: u64,
    baseline_mem: u64,
) {}

#[test]
fn test_check_invariants_inactive_portfolio() {`;
test = test.replace(test_tolerance, test_tolerance_new);

fs.writeFileSync('contracts/src/test.rs', test);
