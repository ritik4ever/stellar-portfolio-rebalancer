const fs = require('fs');
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
    let _current_time = env.ledger().timestamp();

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

const missing_asset_decimals_for = `pub fn balance_to_value(balance: &i128, price: i128) -> i128 {`;
const asset_decimals_for_new = `pub fn asset_decimals_for(portfolio: &Portfolio, asset: Address) -> u32 {
    portfolio.asset_decimals.get(asset).unwrap_or(DEFAULT_ASSET_DECIMALS)
}

pub fn balance_to_value(balance: &i128, price: i128) -> i128 {`;
port = port.replace(missing_asset_decimals_for, asset_decimals_for_new);

// Let's also patch the drift issue (#850) and stale price (#847) while we are here
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
