use soroban_sdk::{contracterror, contracttype, Address, BytesN, Map, String, Vec};

pub const MIN_TRADE_AMOUNT_STROOPS: i128 = 1_000_000;
pub const ALLOCATION_DENOMINATOR: u32 = 10_000;
pub const REFLECTOR_PRICE_DECIMALS: u32 = 14;
pub const DEFAULT_ASSET_DECIMALS: u32 = 7;
pub const MAX_ASSET_DECIMALS: u32 = 18;
pub const SLIPPAGE_POLICY_VERSION_V1: u32 = 1;
pub const CURRENT_SLIPPAGE_POLICY_VERSION: u32 = SLIPPAGE_POLICY_VERSION_V1;
/// Contract version representing the overall deployed logic version.
/// Contract version representing the overall deployed logic version.
/// Version 2 adds `strategy` and `strategy_config` fields to the Portfolio
/// struct, stored under `DataKey::PortfolioV2(u64)`. Legacy portfolios
/// stored under `DataKey::Portfolio(u64)` are migrated on read.
pub const CONTRACT_VERSION: u32 = 2;
/// Contract event schema version matching backend expected schema version.
pub const CONTRACT_EVENT_SCHEMA_VERSION: u32 = 1;
/// Persistent storage schema version. Tracked separately from
/// `CONTRACT_EVENT_SCHEMA_VERSION` (which only versions emitted event
/// shapes): this one versions the on-chain storage layout itself and is
/// advanced by `upgrade::migrate_storage`, which runs automatically as part
/// of `execute_upgrade`. A contract with no stored value is treated as
/// version 0 (pre-versioning / legacy storage).
pub const CURRENT_STORAGE_SCHEMA_VERSION: u32 = 1;
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
pub const MAX_PORTFOLIO_STORAGE_BYTES: u32 = 3_072;
pub const REBALANCE_COOLDOWN_SECONDS: u64 = 3600;
pub const PRICE_MAX_AGE_SECONDS: u64 = 3600;
pub const MAX_TIMESTAMP_DRIFT_SECONDS: u64 = 7200;

pub const MIN_REBALANCE_THRESHOLD: u32 = 1;
pub const MAX_REBALANCE_THRESHOLD: u32 = 50;
pub const MIN_SLIPPAGE_TOLERANCE_BPS: u32 = 10;
pub const MAX_SLIPPAGE_TOLERANCE_BPS: u32 = 500;
pub const MAX_FEE_BPS: u32 = 50;
/// Maximum number of named templates the registry (`DataKey::TemplateNames`)
/// may hold. Bounds `list_templates`'s result size and the per-write cost of
/// rewriting the registry on every `create_template` call.
pub const MAX_TEMPLATES: u32 = 50;

/// Maximum number of portfolios accepted by `batch_rebalance` in one call.
pub const MAX_BATCH_REBALANCE_PORTFOLIOS: u32 = 10;

pub const DEFAULT_CIRCUIT_BREAKER_SPIKE_THRESHOLD_BPS: u32 = 100; // 1%
pub const DEFAULT_CIRCUIT_BREAKER_WINDOW_SECONDS: u64 = 3600; // 1 hour
pub const DEFAULT_GLOBAL_MAX_SLIPPAGE_BPS: u32 = 300; // 3%
pub const TIMELOCK_DELAY_SECONDS: u64 = 172800; // 48 hours

/// Default contract-level max execution slippage per asset class (1%).
pub const DEFAULT_ASSET_SLIPPAGE_BPS: u32 = 100; // 1%
/// Maximum configurable contract-level max execution slippage per asset class (5%).
pub const MAX_ASSET_SLIPPAGE_BPS: u32 = 500; // 5%

/// Rebalancing strategy types, mirroring backend `RebalanceStrategyType`.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum StrategyType {
    /// Rebalance when allocation drift exceeds the configured threshold (default).
    Threshold = 0,
    /// Rebalance on a fixed schedule (e.g. every N seconds).
    Periodic = 1,
    /// Rebalance when market volatility exceeds a threshold.
    Volatility = 2,
    /// Custom rules: minimum interval between rebalances plus threshold check.
    Custom = 3,
}

/// Per-strategy configuration parameters stored alongside the portfolio.
/// Only the fields relevant to the portfolio's chosen strategy are used.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StrategyConfig {
    /// For Periodic: interval in seconds between automatic rebalances.
    pub interval_seconds: u64,
    /// For Volatility: max allowable price change in basis points before triggering.
    pub volatility_threshold_bps: u32,
    /// For Custom: minimum seconds that must elapse between rebalances.
    pub min_interval_seconds: u64,
}

impl Default for StrategyConfig {
    fn default() -> Self {
        StrategyConfig {
            interval_seconds: 604800,          // 7 days
            volatility_threshold_bps: 1000,     // 10%
            min_interval_seconds: 86400,       // 1 day
        }
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CircuitBreakerConfig {
    pub window_seconds: u64,
    pub spike_threshold_bps: u32,
}

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
    pub circuit_breaker_config: CircuitBreakerConfig,
    pub global_max_slippage_bps: u32,
    /// Rebalancing strategy type (defaults to Threshold for backward compatibility).
    pub strategy: StrategyType,
    /// Strategy-specific configuration parameters.
    pub strategy_config: StrategyConfig,
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

/// Legacy portfolio struct without strategy fields — used for on-read migration
/// of portfolios stored before the strategy-aware schema. Once a legacy
/// portfolio is read it is automatically upgraded and re-written under
/// `DataKey::PortfolioV2` so subsequent reads use the new format directly.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacyPortfolio {
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
    pub circuit_breaker_config: CircuitBreakerConfig,
    pub global_max_slippage_bps: u32,
}

impl Default for StrategyType {
    fn default() -> Self {
        StrategyType::Threshold
    }
}

impl From<LegacyPortfolio> for Portfolio {
    fn from(lp: LegacyPortfolio) -> Self {
        Portfolio {
            user: lp.user,
            target_allocations: lp.target_allocations,
            current_balances: lp.current_balances,
            asset_decimals: lp.asset_decimals,
            rebalance_threshold: lp.rebalance_threshold,
            slippage_tolerance: lp.slippage_tolerance,
            slippage_policy_version: lp.slippage_policy_version,
            last_rebalance: lp.last_rebalance,
            total_value: lp.total_value,
            is_active: lp.is_active,
            pause_reason: lp.pause_reason,
            circuit_breaker_config: lp.circuit_breaker_config,
            global_max_slippage_bps: lp.global_max_slippage_bps,
            strategy: StrategyType::Threshold,
            strategy_config: StrategyConfig::default(),
        }
    }
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
    pub platform_name: String,
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
    DCAConfig(u64),
    NavHistory(u64),
    StopLoss(u64, Address),
    CircuitBreakerConfig,
    /// Storage key for portfolios stored with the V2 (strategy-aware) schema.
    PortfolioV2(u64),
    QueuedFeeConfig,
    QueuedUpgrade,
    /// Address of an optional secondary price source (CoinGecko) used by the
    /// oracle price-validation layer.
    CoinGeckoAddress,
    /// Oracle validation configuration (deviation threshold, fallback behavior).
    OracleConfig,
    /// Contract-level max execution slippage (in basis points) for an asset class.
    AssetSlippage(Address),
    Template(String),
    TemplateNames,
    /// Persisted storage schema version; see `CURRENT_STORAGE_SCHEMA_VERSION`.
    SchemaVersion,
    /// Marks `Address` as a registered operator (scoped permission distinct
    /// from full Admin rights) when present and `true`.
    Operator(Address),
    /// Address nominated by the current admin via `propose_admin`, pending
    /// its own `accept_admin` call. Cleared once the transfer completes.
    /// Absence of this key means no admin transfer is in flight.
    PendingAdmin,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DCAConfig {
    pub enabled: bool,
    pub amount: i128, // Fixed USDC amount per execution (in smallest units)
    pub interval: u64, // Execution interval in seconds
    pub next_execution: u64, // Timestamp of next scheduled execution
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
    InvalidAllocationSum = 28,
    BatchTooLarge = 29,
    InvalidOracleAddress = 30,
    TimelockNotElapsed = 31,
    InvalidSlippageLimit = 32,
    InvalidPrice = 33,
    TemplateNotFound = 34,
    TemplateAlreadyExists = 35,
    TooManyTemplates = 36,
    /// Caller authenticated successfully but is neither the contract admin
    /// nor a registered operator for an operator-eligible entrypoint.
    Unauthorized = 37,
    /// `accept_admin` was called while no admin transfer is in flight
    /// (`propose_admin` has never run, or the transfer already completed).
    NoPendingAdmin = 38,
    /// A proposed admin is required to differ from the current admin;
    /// re-proposing the incumbent would be a no-op transfer.
    InvalidAdminProposal = 39,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchRebalanceResult {
    pub portfolio_id: u64,
    pub result: BatchRebalanceResultStatus,
}

// The `#[contracterror]` derive does not emit `SorobanArbitrary` impls, but
// `#[contracttype]` types that embed `Error` (e.g. `BatchRebalanceResultStatus`)
// require it when the `testutils` feature is active. Implement it manually,
// mapping an arbitrary `u32` contract error code onto the matching variant.
// Gate on the package `testutils` feature (NOT `cfg(test)`): the macros emit
// `SorobanArbitrary` code whenever `soroban-sdk/testutils` is enabled, which
// only happens here via this package's `testutils` feature (see Cargo.toml).
#[cfg(feature = "testutils")]
impl soroban_sdk::testutils::arbitrary::SorobanArbitrary for Error {
    type Prototype = u32;
}

#[cfg(feature = "testutils")]
impl soroban_sdk::TryFromVal<soroban_sdk::Env, u32> for Error {
    type Error = soroban_sdk::ConversionError;

    fn try_from_val(
        _env: &soroban_sdk::Env,
        val: &u32,
    ) -> Result<Self, soroban_sdk::ConversionError> {
        Self::try_from(soroban_sdk::Error::from_contract_error(*val))
            .map_err(|_| soroban_sdk::ConversionError)
    }
}

// The `#[contracttype]` derive builds the ScVec representation of tuple
// variants (e.g. `BatchRebalanceResultStatus::Failed(Error)`) by converting
// each payload element to an `ScVal` (`ScVec: TryFrom<(ScSymbol, &Error)>`).
// The `#[contracterror]` macro does not emit a `From<&Error> for ScVal`
// conversion, so provide one for the testutils-gated arbitrary code.
#[cfg(feature = "testutils")]
impl From<&Error> for soroban_sdk::xdr::ScVal {
    fn from(error: &Error) -> Self {
        soroban_sdk::xdr::ScVal::U32(*error as u32)
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BatchRebalanceResultStatus {
    Success,
    Failed(Error),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QueuedFeeConfig {
    pub config: FeeConfig,
    pub execute_after: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct QueuedUpgrade {
    pub new_wasm_hash: BytesN<32>,
    pub execute_after: u64,
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

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetValuation {
    pub asset: Address,
    pub quantity: i128,
    pub oracle_price: i128,
    pub usd_value: i128,
    pub target_pct: u32,
    pub current_pct: u32,
    pub drift: i32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PortfolioValuation {
    pub total_usd_value: i128,
    pub assets: Vec<AssetValuation>,
}

/// Per-asset allocation drift computed from live oracle prices.
/// Only assets with available, non-stale oracle prices are included.
/// The `needs_rebalance` flag is `true` when this asset's drift exceeds the
/// portfolio's `rebalance_threshold`, matching exactly the check used by
/// `build_rebalance_preview` and `execute_rebalance`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetDrift {
    /// The on-chain asset address.
    pub asset: Address,
    /// Current allocation in basis points (0–10 000), computed from live prices.
    pub current_pct: u32,
    /// Target allocation in basis points as stored in the portfolio.
    pub target_pct: u32,
    /// Absolute drift in basis points: |current_pct - target_pct|.
    pub drift_pct: u32,
    /// `true` when `drift_pct` exceeds the portfolio's rebalance threshold.
    pub needs_rebalance: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NavSnapshot {
    pub usd_nav: i128,
    pub sequence: u32,
    pub timestamp: u64,
}
