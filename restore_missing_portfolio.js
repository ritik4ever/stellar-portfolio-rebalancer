const fs = require('fs');

let port = fs.readFileSync('contracts/src/portfolio.rs', 'utf8').replace(/\r\n/g, '\n');

const missing_functions = `
pub fn emit_portfolio_created(env: &Env, portfolio_id: u64, user: Address) {
    env.events().publish(
        (soroban_sdk::Symbol::new(env, "portfolio"), soroban_sdk::Symbol::new(env, "created")),
        (portfolio_id, user),
    );
}

pub fn emit_portfolio_deposit(env: &Env, portfolio_id: u64, asset: Address, amount: i128) {
    env.events().publish(
        (soroban_sdk::Symbol::new(env, "portfolio"), soroban_sdk::Symbol::new(env, "deposit")),
        (portfolio_id, asset, amount),
    );
}

pub fn emit_portfolio_withdraw(env: &Env, portfolio_id: u64, asset: Address, amount: i128) {
    env.events().publish(
        (soroban_sdk::Symbol::new(env, "portfolio"), soroban_sdk::Symbol::new(env, "withdraw")),
        (portfolio_id, asset, amount),
    );
}

pub fn emit_portfolio_rebalanced(env: &Env, portfolio_id: u64, timestamp: u64) {
    env.events().publish(
        (soroban_sdk::Symbol::new(env, "portfolio"), soroban_sdk::Symbol::new(env, "rebalanced")),
        (portfolio_id, timestamp),
    );
}

pub fn emit_cooldown_override(env: &Env, portfolio_id: u64, admin: Address, timestamp: u64) {
    env.events().publish(
        (
            soroban_sdk::Symbol::new(env, "portfolio"),
            soroban_sdk::Symbol::new(env, "cooldown_override"),
        ),
        (portfolio_id, admin, timestamp),
    );
}

pub fn check_portfolio_invariants(portfolio: &Portfolio) -> Result<(), Error> {
    if !portfolio.is_active {
        return Err(Error::PortfolioPaused);
    }
    if !validate_allocations(&portfolio.target_allocations) {
        return Err(Error::InvariantViolation);
    }
    if portfolio.target_allocations.len() > MAX_PORTFOLIO_ASSETS {
        return Err(Error::InvariantViolation);
    }
    if !(1..=50).contains(&portfolio.rebalance_threshold) {
        return Err(Error::InvariantViolation);
    }
    if !(10..=500).contains(&portfolio.slippage_tolerance) {
        return Err(Error::InvariantViolation);
    }
    for (_, balance) in portfolio.current_balances.iter() {
        if balance < 0 {
            return Err(Error::InvariantViolation);
        }
    }
    Ok(())
}

pub fn portfolio_has_positive_balance(portfolio: &Portfolio) -> bool {
    for (_, balance) in portfolio.current_balances.iter() {
        if balance > 0 {
            return true;
        }
    }
    false
}
`;
port += missing_functions;

// Add missing asset_decimals_for if missing
if (!port.includes('pub fn asset_decimals_for')) {
    const missing_asset_decimals_for = `pub fn balance_to_value(balance: i128, price: i128) -> i128 {`;
    const asset_decimals_for_new = `pub fn asset_decimals_for(portfolio: &Portfolio, asset: Address) -> u32 {
    portfolio.asset_decimals.get(asset).unwrap_or(DEFAULT_ASSET_DECIMALS)
}

pub fn balance_to_value(balance: i128, price: i128) -> i128 {`;
    port = port.replace(missing_asset_decimals_for, asset_decimals_for_new);
}

fs.writeFileSync('contracts/src/portfolio.rs', port);


let test = fs.readFileSync('contracts/src/test.rs', 'utf8').replace(/\r\n/g, '\n');

// Fix test.rs remaining try_create_portfolio error
const try_create_old = `client.try_create_portfolio(&user, &allocations, &Map::new(&env), &Map::new(&env), &5, &50, &CURRENT_SLIPPAGE_POLICY_VERSION);`;
const try_create_new = `client.try_create_portfolio(&user, &allocations, &Map::new(&env), &5, &50, &CURRENT_SLIPPAGE_POLICY_VERSION);`;
test = test.replace(try_create_old, try_create_new);

fs.writeFileSync('contracts/src/test.rs', test);
