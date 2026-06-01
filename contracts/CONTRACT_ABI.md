# Portfolio Rebalancer Contract ABI

Contract source:
- `contracts/src/lib.rs`
- `contracts/src/types.rs`
- `contracts/src/portfolio.rs`
- `contracts/src/reflector.rs`

For common invocation examples and debugging commands, see the [Soroban Cookbook](../docs/soroban-cookbook.md).

## Public Functions

### `initialize(env: Env, admin: Address, reflector_address: Address) -> Result<(), Error>`

- **Purpose:** One-time contract initialization with admin and Reflector oracle contract addresses.
- **Parameters:**
  - `env`: Soroban execution environment.
  - `admin`: Admin address stored for privileged actions (for example emergency stop).
  - `reflector_address`: Reflector oracle contract address used for price lookups.
- **Returns:** `Ok(())` on success, `Err(Error::AlreadyInitialized)` if already initialized.
- **Preconditions:**
  - Contract must not already be initialized.

### `create_portfolio(env: Env, user: Address, target_allocations: Map<Address, u32>, asset_decimals: Map<Address, u32>, rebalance_threshold: u32, slippage_tolerance: u32, slippage_policy_version: u32) -> Result<u64, Error>`

- **Purpose:** Creates a new user portfolio and emits a `("portfolio","created")` event.
- **Parameters:**
  - `user`: Portfolio owner; must authorize this call.
  - `target_allocations`: Target allocations per asset (`Address -> percentage`).
  - `asset_decimals`: Per-asset native precision metadata (`Address -> decimals`). Must contain exactly one entry per allocation key, with each value in `1..=MAX_ASSET_DECIMALS` (`18`).
  - `rebalance_threshold`: Drift threshold percent (`1..=50`).
  - `slippage_tolerance`: Slippage tolerance in basis points (`10..=500`).
  - `slippage_policy_version`: Active slippage rule format. Only `SLIPPAGE_POLICY_VERSION_V1` (`1`) is accepted today; stored on the portfolio for client branching as rules evolve.
- **Returns:** `Ok(portfolio_id)` or one of:
  - `Err(Error::InvalidAllocation)`
  - `Err(Error::InvalidAssetDecimals)`
  - `Err(Error::TooManyAssets)`
  - `Err(Error::InvalidThreshold)`
  - `Err(Error::InvalidSlippageTolerance)`
  - `Err(Error::UnsupportedSlippagePolicyVersion)`
- **Preconditions:**
  - `user.require_auth()` succeeds.
  - Allocation map passes `portfolio::validate_allocations`.
  - Asset count is `<= MAX_PORTFOLIO_ASSETS` (`10`).

### `get_portfolio(env: Env, portfolio_id: u64) -> Portfolio`

- **Purpose:** Reads a stored portfolio by ID.
- **Parameters:** `portfolio_id` unique integer ID.
- **Returns:** `Portfolio` value from persistent storage.
- **Preconditions:**
  - Portfolio must exist; otherwise contract panics on `.unwrap()`.

### `get_contract_pause_reason(env: Env) -> PauseReason`

- **Purpose:** Returns the contract-wide pause reason when emergency stop is active.
- **Returns:** `PauseReason::AdminEmergency` while emergency stop is on, otherwise `PauseReason::None`.

### `pause_portfolio(env: Env, portfolio_id: u64, reason: PauseReason) -> Result<(), Error>`

- **Purpose:** Halts a portfolio and records why (`is_active = false`, `pause_reason = reason`). Emits `("portfolio","paused")`.
- **Returns:** `Ok(())` or `Err(Error::InvalidPauseReason)` when `reason` is `PauseReason::None`.
- **Preconditions:** Portfolio owner must authorize.

### `resume_portfolio(env: Env, portfolio_id: u64) -> Result<(), Error>`

- **Purpose:** Reactivates a paused portfolio (`is_active = true`, `pause_reason = None`). Emits `("portfolio","resumed")`.
- **Preconditions:** Portfolio owner must authorize.

### `preview_rebalance(env: Env, portfolio_id: u64) -> Result<RebalancePreview, Error>`

- **Purpose:** Simulation-only path that reports candidate trades, skipped assets, per-asset threshold decisions, and whether rebalance is needed. Does not mutate portfolio state.
- **Returns:** `Ok(RebalancePreview)` or `Err(Error::PreviewUnavailable)` when portfolio value cannot be computed (for example missing or stale oracle prices).
- **Fields in `RebalancePreview`:**
  - `candidate_trades`: Proposed trade amounts per asset (same sign convention as `calculate_rebalance_trades`).
  - `skipped_assets`: Assets excluded from execution with a recorded reason.
  - `skip_reasons`: `Address -> AssetSkipReason` (`MissingPrice`, `StalePrice`, `BelowMinTrade`, `WithinThreshold`).
  - `threshold_decisions`: Per-asset drift versus target and whether drift exceeds `rebalance_threshold`.
  - `rebalance_needed`: `true` when any asset drift exceeds the configured threshold.
  - `total_value`: Aggregate portfolio value used for the simulation.

### `deposit(env: Env, portfolio_id: u64, asset: Address, amount: i128) -> ()`

- **Purpose:** Deposits an amount into `current_balances` for a portfolio and emits `("portfolio","deposit")`.
- **Parameters:**
  - `portfolio_id`: Target portfolio.
  - `asset`: Asset address key used in `current_balances`.
  - `amount`: Amount to add in the asset's native smallest units (per `asset_decimals` at creation).
- **Returns:** No return value.
- **Preconditions / failure behavior:**
  - `amount > 0` (otherwise panic `"Amount must be positive"`).
  - Emergency stop must be off (otherwise panic `"Emergency stop active"`).
  - Portfolio must be active (otherwise panic `"Portfolio paused"`).
  - Portfolio must exist (otherwise panic on `.unwrap()`).
  - Portfolio owner authorization required (`portfolio.user.require_auth()`).

### `check_rebalance_needed(env: Env, portfolio_id: u64) -> bool`

- **Purpose:** Computes current drift versus target allocations using Reflector prices.
- **Parameters:** `portfolio_id`.
- **Returns:** `true` when any tracked asset drift exceeds `rebalance_threshold`, else `false`.
- **Preconditions / failure behavior:**
  - Portfolio and `ReflectorAddress` must exist in storage (panics on missing values).
  - Missing price for an asset is skipped in drift comparison for that asset.

### `execute_rebalance(env: Env, portfolio_id: u64, actual_balances: Map<Address, i128>) -> Result<(), Error>`

- **Purpose:** Validates post-trade balances against slippage tolerance (per `slippage_policy_version` on the portfolio), updates `last_rebalance`, and emits `("portfolio","rebalanced")`.
- **Parameters:**
  - `portfolio_id`: Portfolio to rebalance.
  - `actual_balances`: Actual balances used for slippage checks.
- **Returns:** `Ok(())` or one of:
  - `Err(Error::PortfolioPaused)`
  - `Err(Error::CooldownActive)`
  - `Err(Error::StaleData)`
  - `Err(Error::SlippageExceeded)`
- **Preconditions / failure behavior:**
  - Emergency stop must be off (otherwise panic `"Emergency stop active"`).
  - Portfolio must exist and owner must authorize call.
  - Cooldown must be elapsed (`>= 3600` seconds since last rebalance).

### `set_emergency_stop(env: Env, stop: bool) -> ()`

- **Purpose:** Toggles emergency stop flag in instance storage and records `ContractPauseReason`. Emits `("contract","emergency_stop")` with `(stop, reason_code)`.
- **Parameters:** `stop` boolean.
- **Returns:** No return value.
- **Preconditions:**
  - Admin address stored in `DataKey::Admin` must authorize the call.

## Error Codes (`contracts/src/types.rs`)

`Error` is declared with `#[repr(u32)]`, so values are stable numeric codes:

| Code | Variant | Returned when |
|---|---|---|
| `1` | `InvalidAllocation` | `create_portfolio` receives allocation map that fails validation. |
| `2` | `RebalanceNotNeeded` | Reserved variant; currently not explicitly returned by `lib.rs`. |
| `3` | `EmergencyStop` | Reserved variant; emergency-stop paths currently panic instead of returning this error. |
| `4` | `CooldownActive` | `execute_rebalance` called before cooldown elapsed. |
| `5` | `StaleData` | `execute_rebalance` oracle price older than allowed. |
| `6` | `ExcessiveDrift` | Reserved variant; currently not explicitly returned by `lib.rs`. |
| `7` | `AlreadyInitialized` | `initialize` called after contract already initialized. |
| `8` | `InvalidThreshold` | `create_portfolio` threshold outside `1..=50`. |
| `9` | `InvalidSlippageTolerance` | `create_portfolio` slippage tolerance outside `10..=500`. |
| `10` | `SlippageExceeded` | `execute_rebalance` computed slippage above portfolio tolerance. |
| `11` | `TooManyAssets` | `create_portfolio` target allocation size above `MAX_PORTFOLIO_ASSETS`. |
| `12` | `InvalidAssetDecimals` | `asset_decimals` keys or values invalid for `target_allocations`. |
| `13` | `UnsupportedSlippagePolicyVersion` | Unknown `slippage_policy_version` at creation. |
| `14` | `PortfolioPaused` | `execute_rebalance` while `is_active` is false. |
| `15` | `InvalidPauseReason` | `pause_portfolio` called with `PauseReason::None`. |
| `16` | `PreviewUnavailable` | `preview_rebalance` cannot compute a reliable total value. |

## Precision and slippage policy constants

| Constant | Value | Meaning |
|---|---|---|
| `REFLECTOR_PRICE_DECIMALS` | `14` | Oracle price scale divisor for valuation. |
| `DEFAULT_ASSET_DECIMALS` | `7` | Typical Stellar native asset scale (stroops). |
| `SLIPPAGE_POLICY_VERSION_V1` | `1` | Basis-point slippage check against expected balances. |
| `CURRENT_SLIPPAGE_POLICY_VERSION` | `1` | Latest supported policy version at deploy time. |

## XDR/Contract Type References

The contract uses Soroban contract types (`#[contracttype]`) which are encoded as Soroban `ScVal`/XDR values over RPC.

- `Address` (`soroban_sdk::Address`)
  - Used for users, assets, and external contract references.
- `Map<Address, u32>`
  - Used for `target_allocations`, `asset_decimals`, and percentage or decimal metadata.
- `Map<Address, i128>`
  - Used for `current_balances`, `actual_balances`, and `candidate_trades`.
- `Portfolio` (`contracts/src/types.rs`)
  - Composite struct:
  - `user: Address`
  - `target_allocations: Map<Address, u32>`
  - `current_balances: Map<Address, i128>`
  - `asset_decimals: Map<Address, u32>`
  - `rebalance_threshold: u32`
  - `slippage_tolerance: u32`
  - `slippage_policy_version: u32`
  - `last_rebalance: u64`
  - `total_value: i128`
  - `is_active: bool`
  - `pause_reason: PauseReason`
- `PauseReason` (`#[repr(u32)]`)
  - `None` (`0`), `UserPaused` (`1`), `AdminEmergency` (`2`), `VolatilityCircuitBreaker` (`3`), `CooldownActive` (`4`)
- `AssetSkipReason` (`#[repr(u32)]`)
  - `MissingPrice` (`1`), `StalePrice` (`2`), `BelowMinTrade` (`3`), `WithinThreshold` (`4`)
- `RebalancePreview`
  - See `preview_rebalance` above.
- `ThresholdDecision`
  - `current_percent`, `target_percent`, `drift`, `exceeds_threshold`
- `Asset` (`contracts/src/reflector.rs`)
  - Enum: `Stellar(Address)` or `Other(Symbol)`.
- `PriceData` (`contracts/src/reflector.rs`)
  - Struct with `price: i128` and `timestamp: u64`.

For call builders and generated client bindings, use Soroban CLI/SDK tooling against the compiled WASM artifact.
