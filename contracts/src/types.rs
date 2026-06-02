use soroban_sdk::{contracterror, contracttype, Address, Map};

// Stellar assets use 7-decimal precision where 1 XLM = 10^7 stroops.
// 1_000_000 stroops equals 0.1 XLM, which acts as the minimum executable trade size.
pub const MIN_TRADE_AMOUNT_STROOPS: i128 = 1_000_000;
/// Maximum number of assets allowed in a single portfolio (#296).
///
/// Soroban persistent storage entries are bounded by ledger entry size limits.
/// Each additional asset adds two `Map` entries (target allocation + current
/// balance) plus oracle price lookup overhead during rebalance.
/// 10 assets is the tested practical maximum that keeps all operations within
/// Soroban CPU and memory budgets.
///
/// Attempting to create a portfolio with more assets returns [`Error::TooManyAssets`].
pub const MAX_PORTFOLIO_ASSETS: u32 = 10;

/// Minimum allowed rebalance threshold percentage.
///
/// The rebalance threshold determines when a portfolio drift is significant
/// enough to trigger a rebalance. Values below 1% are too sensitive and would
/// cause excessive rebalancing with minimal benefit.
pub const MIN_REBALANCE_THRESHOLD: u32 = 1;

/// Maximum allowed rebalance threshold percentage.
///
/// The rebalance threshold determines when a portfolio drift is significant
/// enough to trigger a rebalance. Values above 50% are too permissive and would
/// allow portfolios to drift far from target allocations before rebalancing.
pub const MAX_REBALANCE_THRESHOLD: u32 = 50;

/// Minimum allowed slippage tolerance in basis points.
///
/// Slippage tolerance is expressed in basis points (1/100th of a percent).
/// 10 basis points = 0.1%. Values below this are too strict for practical
/// trading on decentralized exchanges.
pub const MIN_SLIPPAGE_TOLERANCE_BPS: u32 = 10;

/// Maximum allowed slippage tolerance in basis points.
///
/// Slippage tolerance is expressed in basis points (1/100th of a percent).
/// 500 basis points = 5%. Values above this would allow excessive slippage
/// that could significantly impact portfolio value.
pub const MAX_SLIPPAGE_TOLERANCE_BPS: u32 = 500;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Portfolio {
    pub user: Address,
    pub target_allocations: Map<Address, u32>,
    pub current_balances: Map<Address, i128>,
    pub rebalance_threshold: u32,
    pub slippage_tolerance: u32,
    pub last_rebalance: u64,
    pub total_value: i128,
    pub is_active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    ReflectorAddress,
    EmergencyStop,
    Initialized,
    Portfolio(u64),
    NextPortfolioId,
    Steward(u64),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    InvalidAllocation = 1,
    RebalanceNotNeeded = 2,
    EmergencyStop = 3,
    CooldownActive = 4,
    StaleData = 5,
    ExcessiveDrift = 6,
    AlreadyInitialized = 7,
    InvalidThreshold = 8,
    InvalidSlippageTolerance = 9,
    SlippageExceeded = 10,
    TooManyAssets = 11,
    Unauthorized = 12,
    StalePrice = 13,
    MissingPrice = 14,
    MalformedPrice = 15,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ValuationError {
    StaleData = 1,
    MissingPrice = 2,
    MalformedData = 3,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum CapabilityFlag {
    PerPortfolioSteward = 1,
    DifferentiatedPricing = 2,
    EmergencyStop = 4,
}
