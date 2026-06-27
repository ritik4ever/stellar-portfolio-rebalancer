use soroban_sdk::{contracterror, contracttype, Address, BytesN, Map, Vec};

// Stellar assets use 7-decimal precision where 1 XLM = 10^7 stroops.
// 1_000_000 stroops equals 0.1 XLM, which acts as the minimum executable trade size.
pub const MIN_TRADE_AMOUNT_STROOPS: i128 = 1_000_000;
/// Reflector oracle prices are scaled to this many decimal places.
pub const REFLECTOR_PRICE_DECIMALS: u32 = 14;
/// Default native-asset decimal scale when callers omit per-asset metadata.
pub const DEFAULT_ASSET_DECIMALS: u32 = 7;
/// Maximum supported asset decimal metadata (guards misconfiguration).
pub const MAX_ASSET_DECIMALS: u32 = 18;
/// Slippage tolerance is compared in basis points against expected post-trade balances.
pub const SLIPPAGE_POLICY_VERSION_V1: u32 = 1;
/// Active on-chain slippage rule format; bump when tolerance math changes.
pub const CURRENT_SLIPPAGE_POLICY_VERSION: u32 = SLIPPAGE_POLICY_VERSION_V1;
/// Contract version representing the overall deployed logic version.
pub const CONTRACT_VERSION: u32 = 1;
/// Contract event schema version matching backend expected schema version.
pub const CONTRACT_EVENT_SCHEMA_VERSION: u32 = 1;
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
/// Maximum estimated XDR footprint in bytes allowed for one stored portfolio record.
///
/// The contract estimates the serialized size of the `Portfolio` value before it is
/// written to persistent storage and rejects obviously risky payloads early.
pub const MAX_PORTFOLIO_STORAGE_BYTES: u32 = 3_072;
pub const REBALANCE_COOLDOWN_SECONDS: u64 = 3600;
pub const PRICE_MAX_AGE_SECONDS: u64 = 3600;
/// Maximum acceptable ledger timestamp forward drift in seconds (#416).
///
/// If the ledger timestamp jumps more than this amount between consecutive
/// time-sensitive operations, the contract rejects the call to guard against
/// surprising ledger time assumptions (e.g., cooldown bypass, price staleness
/// miscalculation). 7200 seconds = 2 hours is well above any expected network
/// clock drift but prevents extreme outlier timestamps from being used.
pub const MAX_TIMESTAMP_DRIFT_SECONDS: u64 = 7200;

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
pub struct ContractCapabilitySummary {
    pub version: u32,
    pub schema_version: u32,
    pub capability_flags: u32,
    pub min_rebalance_threshold: u32,
    pub max_rebalance_threshold: u32,
    pub min_slippage_tolerance_bps: u32,
    pub max_slippage_tolerance_bps: u32,
    pub max_portfolio_assets: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Portfolio {
    pub user: Address,
    pub target_allocations: Map<Address, u32>,
    pub current_balances: Map<Address, i128>,
    pub asset_decimals: Map<Address, u32>,
    pub rebalance_threshold: u32,
    pub slippage_tolerance: u32,
    pub slippage_policy_version: u32,
    pub last_rebalance: u64,
    pub total_value: i128,
    pub is_active: bool,
    pub pause_reason: PauseReason,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PauseReason {
    None = 0,
    UserPaused = 1,
    AdminEmergency = 2,
    VolatilityCircuitBreaker = 3,
    CooldownActive = 4,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum AssetSkipReason {
    MissingPrice = 1,
    StalePrice = 2,
    BelowMinTrade = 3,
    WithinThreshold = 4,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ThresholdDecision {
    pub current_percent: u32,
    pub target_percent: u32,
    pub drift: u32,
    pub exceeds_threshold: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RebalancePreview {
    pub candidate_trades: Map<Address, i128>,
    pub skipped_assets: Vec<Address>,
    pub skip_reasons: Map<Address, AssetSkipReason>,
    pub threshold_decisions: Map<Address, ThresholdDecision>,
    pub rebalance_needed: bool,
    pub total_value: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeConfig {
    pub fee_bps: u32,
    pub fee_recipient: Address,
    pub enabled: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeEvent {
    pub from_hash: BytesN<32>,
    pub to_hash: BytesN<32>,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Admin address for privileged actions such as emergency stop.
    /// This can be a standard account or a contract-managed governance address.
    Admin,
    ReflectorAddress,
    EmergencyStop,
    ContractPauseReason,
    Initialized,
    Portfolio(u64),
    NextPortfolioId,
    Steward(u64),
    FeeConfig,
    UpgradeAuthority,
    WasmHash,
    LastTimestamp,
}

// Portfolio identifiers (`u64`) are derived deterministically by a monotonically
// increasing counter stored under `DataKey::NextPortfolioId` in contract
// persistent storage. The first created portfolio receives id `1`. This
// deterministic strategy ensures off-chain consumers can correlate a portfolio
// consistently given the same contract storage state and avoids reliance on
// runtime-generated randomness or non-deterministic timestamps.

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
}

#[repr(u32)]
pub enum CapabilityFlag {
    PerPortfolioSteward = 1 << 0,
    DifferentiatedPricing = 1 << 1,
    EmergencyStop = 1 << 2,
}
