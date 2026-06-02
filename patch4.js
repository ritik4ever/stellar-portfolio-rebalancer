const fs = require('fs');

let lib = fs.readFileSync('contracts/src/lib.rs', 'utf8').replace(/\r\n/g, '\n');

// lib.rs: Fix execute_rebalance_internal missing match arms
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
lib = lib.replace(exec_old2, exec_new2);

// lib.rs: Fix transfer_steward
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

// lib.rs: Fix `for...else` loop that apply_issues missed correctly
const for_else_old = `            if let Some(price_data) =
                reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
            {

                }
                current_prices.set(asset.clone(), price_data.price);
            } else {

            }
        }`;
const for_else_new = `            if let Some(price_data) =
                reflector_client.lastprice(&crate::reflector::Asset::Stellar(asset.clone()))
            {
                current_prices.set(asset.clone(), price_data.price);
            } else {
                return Err(Error::StaleData);
            }
        }`;
lib = lib.replace(for_else_old, for_else_new);

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
            if price_data.is_stale(current_time, 3600) {
                return Err(Error::StaleData);
            }
            total_value += balance_to_value(balance, price_data.price);
        } else {
            return Err(Error::StaleData);
        }
    }

    Ok(total_value)
}`;
port = port.replace(calc_old, calc_new);

fs.writeFileSync('contracts/src/portfolio.rs', port);
