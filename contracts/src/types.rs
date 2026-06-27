use soroban_sdk::{contracterror, contracttype, Address, BytesN, Map, Vec};

pub const MIN_TRADE_AMOUNT_STROOPS: i128 = 1_000_000;
pub const REFLECTOR_PRICE_DECIMALS: u32 = 14;
pub const DEFAULT_ASSET_DECIMALS: u32 = 7;
pub const MAX_ASSET_DECIMALS: u32 = 18;
pub const SLIPPAGE_POLICY_VERSION_V1: u32 = 1;
pub const CURRENT_SLIPPAGE_POLICY_VERSION: u32 = SLIPPAGE_POLICY_VERSION_V1;
pub const MAX_PORTFOLIO_ASSETS: u32 = 10;
pub const MAX_PORTFOLIO_STORAGE_BYTES: u32 = 3_072;
pub const MIN_COOLDOWN_SECONDS: u64 = 600;
pub const MAX_COOLDOWN_SECONDS: u64 = 86400;
pub const PRICE_MAX_AGE_SECONDS: u64 = 3600;
pub const MAX_TIMESTAMP_DRIFT_SECONDS: u64 = 7200;

pub const MIN_REBALANCE_THRESHOLD: u32 = 1;

pub const MAX_REBALANCE_THRESHOLD: u32 = 50;

pub const MIN_SLIPPAGE_TOLERANCE_BPS: u32 = 10;

pub const MAX_SLIPPAGE_TOLERANCE_BPS: u32 = 500;

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
    pub cooldown: u64,
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
    SupportedAssets,
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
    InvalidCooldown = 12,
    AssetNotSupported = 13,
    MissingPrice = 14,
    InvalidAmount = 15,
    PortfolioPaused = 16,
    InsufficientBalance = 17,
    PortfolioStorageFootprintTooLarge = 18,
    UnsupportedSlippagePolicyVersion = 19,
    InvalidAssetDecimals = 20,
    PreviewUnavailable = 21,
    InvariantViolation = 22,
    WithdrawFailed = 23,
    PortfolioNotFound = 24,
    InvalidWithdrawAmount = 25,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PortfolioOption {
    None,
    Some(Portfolio),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfigView {
    pub admin: Address,
    pub reflector_address: Address,
    pub emergency_stop: bool,
    pub portfolio: PortfolioOption,
}

#[repr(u32)]
pub enum CapabilityFlag {
    PerPortfolioSteward = 1 << 0,
    DifferentiatedPricing = 1 << 1,
    EmergencyStop = 1 << 2,
}
