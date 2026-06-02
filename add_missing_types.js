const fs = require('fs');

let types = fs.readFileSync('contracts/src/types.rs', 'utf8').replace(/\r\n/g, '\n');

// Add Missing Errors
const error_enum_end = "    InvalidAssetThreshold = 27,\n}";
const new_errors = `    InvalidAssetThreshold = 27,
    InvariantViolation = 28,
    InvalidAssetDecimals = 29,
    UnsupportedSlippagePolicyVersion = 30,
    InvalidWithdrawAmount = 31,
    PortfolioPaused = 32,
    InsufficientBalance = 33,
    MissingPrice = 34,
    PortfolioNotFound = 35,
    PortfolioStorageFootprintTooLarge = 36,
    PreviewUnavailable = 37,
}`;
types = types.replace(error_enum_end, new_errors);

// Add CapabilityFlag enum
const cap_flag = `#[repr(u32)]
pub enum CapabilityFlag {
    PerPortfolioSteward = 1 << 0,
    DifferentiatedPricing = 1 << 1,
    EmergencyStop = 1 << 2,
}`;
types += "\n" + cap_flag + "\n";

fs.writeFileSync('contracts/src/types.rs', types);

let lib = fs.readFileSync('contracts/src/lib.rs', 'utf8').replace(/\r\n/g, '\n');
// lib.rs missing validate_slippage_policy_version
const validate_slippage = `fn validate_slippage_policy_version(version: u32) -> bool {
    version == CURRENT_SLIPPAGE_POLICY_VERSION
}

fn guard_ledger_timestamp`;
lib = lib.replace("fn guard_ledger_timestamp", validate_slippage);
fs.writeFileSync('contracts/src/lib.rs', lib);

// Add missing function asset_decimals_for in portfolio.rs
let port = fs.readFileSync('contracts/src/portfolio.rs', 'utf8').replace(/\r\n/g, '\n');
const missing_asset_decimals_for = `pub fn balance_to_value(balance: &i128, price: i128) -> i128 {`;
const asset_decimals_for_new = `pub fn asset_decimals_for(portfolio: &Portfolio, asset: Address) -> u32 {
    portfolio.asset_decimals.get(asset).unwrap_or(DEFAULT_ASSET_DECIMALS)
}

pub fn balance_to_value(balance: &i128, price: i128) -> i128 {`;
port = port.replace(missing_asset_decimals_for, asset_decimals_for_new);

fs.writeFileSync('contracts/src/portfolio.rs', port);
