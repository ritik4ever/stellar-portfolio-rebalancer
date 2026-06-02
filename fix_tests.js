const fs = require('fs');

let test = fs.readFileSync('contracts/src/test.rs', 'utf8').replace(/\r\n/g, '\n');

// Fix assert_cost_within_tolerance
const assert_cost_old = `fn assert_cost_within_tolerance(
    cpu: u64,
    mem: u64,
    baseline_cpu: u64,
    baseline_mem: u64,
) {}`;
const assert_cost_new = `fn assert_cost_within_tolerance(
    _name: &str,
    cpu: u64,
    mem: u64,
    baseline_cpu: u64,
    baseline_mem: u64,
) {}`;
test = test.replace(assert_cost_old, assert_cost_new);

// Fix calculate_portfolio_value missing asset_decimals
const calc_val_old = `    let value = crate::portfolio::calculate_portfolio_value(
        &env,
        &portfolio.current_balances,
        &reflector_client,
    )`;
const calc_val_new = `    let value = crate::portfolio::calculate_portfolio_value(
        &env,
        &portfolio.current_balances,
        &portfolio.asset_decimals,
        &reflector_client,
    )`;
test = test.replace(calc_val_old, calc_val_new);
test = test.replace(calc_val_old, calc_val_new);
test = test.replace(calc_val_old, calc_val_new);
test = test.replace(calc_val_old, calc_val_new); // just in case

// Fix try_create_portfolio missing arguments
// client.try_create_portfolio(&user, &allocations, &5, &50); -> client.try_create_portfolio(&user, &allocations, &asset_decimals, &asset_thresholds, &5, &50, &CURRENT_SLIPPAGE_POLICY_VERSION);
const try_create_old = `client.try_create_portfolio(&user, &allocations, &5, &50)`;
const try_create_new = `client.try_create_portfolio(&user, &allocations, &Map::new(&env), &Map::new(&env), &5, &50, &CURRENT_SLIPPAGE_POLICY_VERSION)`;
test = test.replace(try_create_old, try_create_new);
test = test.replace(try_create_old, try_create_new);
test = test.replace(try_create_old, try_create_new);

fs.writeFileSync('contracts/src/test.rs', test);
