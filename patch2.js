const fs = require('fs');

let content = fs.readFileSync('contracts/src/lib.rs', 'utf8');

// 1. Fix check_rebalance_needed missing match arm
const r_need_old = `        let total_value = match portfolio::calculate_portfolio_value(
            &env,
            &portfolio.current_balances,
            &portfolio.asset_decimals,
            &reflector_client,
        ) {
            Ok(val) => val,
        };`;
const r_need_new = `        let total_value = match portfolio::calculate_portfolio_value(
            &env,
            &portfolio.current_balances,
            &portfolio.asset_decimals,
            &reflector_client,
        ) {
            Ok(val) => val,
            Err(_) => return false,
        };`;
content = content.replace(r_need_old, r_need_new);

// 2. Fix transfer_steward missing variable assignment
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

// 3. Fix execute_rebalance_internal missing match arms
const exec_old = `        if has_actual_balances {
            let total_value = portfolio::calculate_portfolio_value(
                env,
                &portfolio.current_balances,
                &portfolio.asset_decimals,
                &reflector_client,
            )

            if total_value > 0 {`;
const exec_new = `        if has_actual_balances {
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
content = content.replace(exec_old, exec_new);

fs.writeFileSync('contracts/src/lib.rs', content);
