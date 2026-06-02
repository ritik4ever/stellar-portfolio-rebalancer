const fs = require('fs');

let types = fs.readFileSync('contracts/src/types.rs', 'utf8').replace(/\r\n/g, '\n');

const error_enum_end = `    TooManyAssets = 11,\n\n}`;
const new_errors = `    TooManyAssets = 11,
    StaleOraclePrice = 12,
    InvalidAssetThreshold = 13,
    InvariantViolation = 14,
    InvalidAssetDecimals = 15,
    UnsupportedSlippagePolicyVersion = 16,
    InvalidWithdrawAmount = 17,
    PortfolioPaused = 18,
    InsufficientBalance = 19,
    MissingPrice = 20,
    PortfolioNotFound = 21,
    PortfolioStorageFootprintTooLarge = 22,
    PreviewUnavailable = 23,
    InvalidCooldown = 24,
    AssetNotSupported = 25,
    InvalidAmount = 26,
    WithdrawFailed = 27,
}`;
types = types.replace(error_enum_end, new_errors);

// Also capability flag just in case it didn't append (it did, but let's make sure it's correct)
fs.writeFileSync('contracts/src/types.rs', types);
