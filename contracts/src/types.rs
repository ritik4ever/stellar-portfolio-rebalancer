use soroban_sdk::{contracterror, contracttype, Address, Map, Vec};

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
pub enum DataKey {
    Admin,
    ReflectorAddress,
    EmergencyStop,
    ContractPauseReason,
    Initialized,
    Portfolio(u64),
    NextPortfolioId,
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
    InvalidAssetDecimals = 12,
    UnsupportedSlippagePolicyVersion = 13,
    PortfolioPaused = 14,
    InvalidPauseReason = 15,
    PreviewUnavailable = 16,
}

pub fn validate_asset_decimals(
    allocations: &Map<Address, u32>,
    asset_decimals: &Map<Address, u32>,
) -> bool {
    if allocations.len() != asset_decimals.len() {
        return false;
    }
    for (asset, _) in allocations.iter() {
        match asset_decimals.get(asset) {
            Some(decimals) if (1..=MAX_ASSET_DECIMALS).contains(&decimals) => {}
            _ => return false,
        }
    }
    true
}

pub fn validate_slippage_policy_version(version: u32) -> bool {
    version == SLIPPAGE_POLICY_VERSION_V1
}

pub fn asset_decimals_for(portfolio: &Portfolio, asset: Address) -> u32 {
    portfolio
        .asset_decimals
        .get(asset)
        .unwrap_or(DEFAULT_ASSET_DECIMALS)
}
