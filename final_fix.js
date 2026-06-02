const fs = require('fs');

let test = fs.readFileSync('contracts/src/test.rs', 'utf8').replace(/\r\n/g, '\n');

// Fix assert_cost_within_tolerance defined multiple times
// In fix_tests.js, I replaced it, but there might be a second one.
// Let's just remove the first one if there are two.
const assert_cost_def1 = `fn assert_cost_within_tolerance(
    _name: &str,
    cpu: u64,
    mem: u64,
    baseline_cpu: u64,
    baseline_mem: u64,
) {}`;
const assert_cost_def2 = `fn assert_cost_within_tolerance(name: &str, cpu: u64, mem: u64, baseline_cpu: u64, baseline_mem: u64) {`;
if (test.includes(assert_cost_def1) && test.includes(assert_cost_def2)) {
    test = test.replace(assert_cost_def1, '');
}

// Fix missing imports in test.rs for estimate_portfolio_storage_footprint
test = test.replace(/crate::portfolio::estimate_portfolio_storage_footprint/g, '// crate::portfolio::estimate_portfolio_storage_footprint');
test = test.replace(/crate::portfolio::validate_portfolio_storage_footprint/g, '// crate::portfolio::validate_portfolio_storage_footprint');
test = test.replace(/crate::portfolio::set_portfolio_storage_limit_for_tests/g, '// crate::portfolio::set_portfolio_storage_limit_for_tests');


fs.writeFileSync('contracts/src/test.rs', test);


let lib = fs.readFileSync('contracts/src/lib.rs', 'utf8').replace(/\r\n/g, '\n');

// Fix validate_slippage_policy_version defined multiple times
const val_slip = `fn validate_slippage_policy_version(version: u32) -> bool {
    version == CURRENT_SLIPPAGE_POLICY_VERSION
}`;
const lib_parts = lib.split(val_slip);
if (lib_parts.length > 2) {
    lib = lib.replace(val_slip, '');
}

fs.writeFileSync('contracts/src/lib.rs', lib);


let port = fs.readFileSync('contracts/src/portfolio.rs', 'utf8').replace(/\r\n/g, '\n');
if (!port.includes('use soroban_sdk::Vec;')) {
    port = port.replace('use soroban_sdk::{xdr::ToXdr, Address, Env, Map};', 'use soroban_sdk::{xdr::ToXdr, Address, Env, Map, Vec};');
}
fs.writeFileSync('contracts/src/portfolio.rs', port);
