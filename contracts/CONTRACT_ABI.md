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
    - This may be a standard account or a contract-managed/governance address.
    - Future multisig or governed deployments can provide an address that authorizes via Soroban auth rules.
  - `reflector_address`: Reflector oracle contract address used for price lookups.
- **Returns:** `Ok(())` on success, `Err(Error::AlreadyInitialized)` if already initialized.
- **Preconditions:**
  - Contract must not already be initialized.



- **Purpose:** Creates a new user portfolio and emits a `("portfolio","created")` event.
- **Parameters:**
  - `user`: Portfolio owner; must authorize this call.
  - `target_allocations`: Target allocations per asset (`Address -> percentage`).

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

#### Portfolio ID derivation (deterministic)

- **Strategy:** Portfolio IDs are allocated from a monotonically increasing
  counter stored in persistent contract storage under `DataKey::NextPortfolioId`.
  The counter starts at `1` and increments by one for each created portfolio.
- **Behavioral guarantee:** Given the same contract persistent state, the
  assigned portfolio id for a `create_portfolio` invocation is deterministic.
  Off-chain systems may rely on this stable mapping to correlate portfolios
  across sync operations.
- **Notes:** The contract exposes `get_portfolio` to read portfolio contents by
  id. Consumers should store the returned id along with the portfolio metadata
  to maintain a canonical reference.

### `get_portfolio(env: Env, portfolio_id: u64) -> Portfolio`

- **Purpose:** Reads a stored portfolio by ID.
- **Parameters:** `portfolio_id` unique integer ID.
- **Returns:** `Portfolio` value from persistent storage.
- **Preconditions:**
  - Portfolio must exist; otherwise contract panics on `.unwrap()`.

### `deposit(env: Env, portfolio_id: u64, asset: Address, amount: i128, memo: String) -> Result<(), Error>`

- **Purpose:** Deposits an amount into `current_balances` for a portfolio and emits `("portfolio","deposit")`.
- **Parameters:**
  - `portfolio_id`: Target portfolio.
  - `asset`: Asset address key used in `current_balances`.
  - `amount`: Amount to add.
  - `memo`: Caller-supplied deposit memo included in the emitted event.
- **Returns:** `Ok(())` on success, or one of:
  - `Err(Error::InvalidAmount)` — amount is zero or negative.
  - `Err(Error::EmergencyStop)` — contract is in emergency stop.
- **Event payload:** `(portfolio_id: u64, asset: Address, amount: i128, memo: String)`
- **Preconditions / failure behavior:**
  - Portfolio must exist (otherwise panics on `.unwrap()`).
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
- **Returns:** `Ok(())` on success, or one of:
  - `Err(Error::EmergencyStop)` — contract is in emergency stop.
  - `Err(Error::CooldownActive)` — less than 3600 seconds since last rebalance.
  - `Err(Error::SlippageExceeded)` — computed slippage above portfolio tolerance.
  - `Err(Error::StaleData)` — a target asset has stale Reflector price data.
  - `Err(Error::MissingPriceData)` — Reflector returned no price for a target asset.
  - `Err(Error::TimestampDrift)` — ledger timestamp drift exceeds acceptable range.
- **Preconditions / failure behavior:**
  - Portfolio must exist and owner must authorize call.
  - Portfolio owner authorization required (`portfolio.user.require_auth()`).

### `set_emergency_stop(env: Env, stop: bool) -> ()`

- **Purpose:** Toggles emergency stop flag in instance storage and records `ContractPauseReason`. Emits `("contract","emergency_stop")` with `(stop, reason_code)`.
- **Parameters:** `stop` boolean.
- **Returns:** No return value.
- **Preconditions:**
  - Admin address stored in `DataKey::Admin` must authorize the call.
  - The configured admin may be a multisig/governance contract address, as long as it authorizes via Soroban auth.

### `set_fee_config(env: Env, config: FeeConfig) -> ()`

- **Purpose:** Sets fee configuration for the contract. Disabled by default (`enabled: false`).
- **Parameters:**
  - `config`: `FeeConfig` struct with `fee_bps: u32`, `fee_recipient: Address`, `enabled: bool`.
- **Returns:** No return value.
- **Panics:** When `enabled` is `true` and `fee_bps > 1000` (10% max).
- **Preconditions:**
  - Admin address must authorize the call.

### `get_fee_config(env: Env) -> FeeConfig`

- **Purpose:** Returns the current fee configuration.
- **Returns:** `FeeConfig` with `enabled: false` defaults when not yet set.

### `upgrade(env: Env, new_wasm_hash: BytesN<32>) -> ()`

- **Purpose:** Upgrades the contract WASM to a new version. Emits `("portfolio","upgraded")` event.
- **Parameters:**
  - `new_wasm_hash`: 32-byte WASM hash of the new contract code.
- **Returns:** No return value.
- **Event payload:** `UpgradeEvent { from_hash: Bytes, to_hash: Bytes, timestamp: u64 }`
- **Preconditions:**
  - Admin address must authorize the call.

### `min_rebalance_threshold(env: Env) -> u32`

- **Purpose:** Returns the minimum allowed rebalance threshold percentage.
- **Returns:** `MIN_REBALANCE_THRESHOLD` (currently `1`).

### `max_rebalance_threshold(env: Env) -> u32`

- **Purpose:** Returns the maximum allowed rebalance threshold percentage.
- **Returns:** `MAX_REBALANCE_THRESHOLD` (currently `50`).

### `min_slippage_tolerance_bps(env: Env) -> u32`

- **Purpose:** Returns the minimum allowed slippage tolerance in basis points.
- **Returns:** `MIN_SLIPPAGE_TOLERANCE_BPS` (currently `10`).

### `max_slippage_tolerance_bps(env: Env) -> u32`

- **Purpose:** Returns the maximum allowed slippage tolerance in basis points.
- **Returns:** `MAX_SLIPPAGE_TOLERANCE_BPS` (currently `500`).

### `max_portfolio_assets(env: Env) -> u32`

- **Purpose:** Returns the maximum number of assets allowed in a portfolio.
- **Returns:** `MAX_PORTFOLIO_ASSETS` (currently `10`).

### `simulate_rebalance(env: Env, portfolio_id: u64, actual_balances: Map<Address, i128>) -> Result<Map<Address, i128>, Error>`

- **Purpose:** Non-mutating simulation path for backend dry-run APIs. Returns a map of planned trades where positive values indicate buys and negative values indicate sells. Surfaces policy failures (cooldown, stale/missing prices, slippage) as `Error` values instead of panics.
- **Parameters:**
  - `portfolio_id`: Portfolio to simulate rebalance for.
  - `actual_balances`: Optional actual balances for slippage checks; pass an empty map to skip slippage validation.
- **Returns:** `Ok(Map<Address, i128>)` with planned trades, or one of:
  - `Err(Error::CooldownActive)` if the portfolio is still in cooldown.
  - `Err(Error::StaleData)` if any price is missing or stale.
  - `Err(Error::SlippageExceeded)` if provided `actual_balances` exceed the portfolio's slippage tolerance.
- **Preconditions / failure behavior:**
  - Does not require portfolio owner authorization and does not mutate persistent storage.

## Error Codes (`contracts/src/types.rs`)

`Error` is declared with `#[repr(u32)]`, so values are stable numeric codes:

| Code | Variant | Returned when |
|---|---|---|
| `1` | `InvalidAllocation` | `create_portfolio` receives allocation map that fails validation. |
| `2` | `RebalanceNotNeeded` | Reserved — not currently emitted. |
| `3` | `EmergencyStop` | `deposit` or `execute_rebalance` called while emergency stop is active. |
| `4` | `CooldownActive` | `execute_rebalance` called before cooldown (3600 s) elapses. |
| `5` | `StaleData` | `execute_rebalance` receives stale price data from the Reflector oracle. |
| `6` | `ExcessiveDrift` | Reserved — not currently emitted. |
| `7` | `AlreadyInitialized` | `initialize` called after contract already initialized. |
| `8` | `InvalidThreshold` | `create_portfolio` threshold outside `MIN_REBALANCE_THRESHOLD..=MAX_REBALANCE_THRESHOLD` (i.e., `1..=50`). |
| `9` | `InvalidSlippageTolerance` | `create_portfolio` slippage tolerance outside `MIN_SLIPPAGE_TOLERANCE_BPS..=MAX_SLIPPAGE_TOLERANCE_BPS` (i.e., `10..=500`). |
| `10` | `SlippageExceeded` | `execute_rebalance` computed slippage above portfolio tolerance. |
| `11` | `TooManyAssets` | `create_portfolio` target allocation size above `MAX_PORTFOLIO_ASSETS`. |
| `12` | `TimestampDrift` | `guard_ledger_timestamp` detects backward or excessive forward drift. |
| `13` | `InvalidAmount` | `deposit` receives a zero or negative amount. |
| `14` | `MissingPriceData` | `execute_rebalance` cannot find a Reflector price for a target asset. |
| `15` | `InvalidAssetDecimals` | `create_portfolio` receives missing or unsupported asset decimal metadata. |
| `16` | `UnsupportedSlippagePolicyVersion` | `create_portfolio` receives a slippage policy version other than the current version. |
| `17` | `PortfolioPaused` | `execute_rebalance` is called for an inactive portfolio. |
| `18` | `PreviewUnavailable` | Rebalance preview cannot be computed from available price data. |

## Timestamp Drift Guard

The contract maintains a **last observed ledger timestamp** (`DataKey::LastTimestamp`) in instance
storage to defend against surprising or malicious ledger time assumptions.

**Guard logic (`guard_ledger_timestamp`):**
1. On every time-sensitive mutation (`create_portfolio`, `execute_rebalance`), read the current
   `env.ledger().timestamp()`.
2. If a `LastTimestamp` is already stored:
   - **Backward drift:** `current < last_ts` → returns `Err(Error::TimestampDrift)`.
   - **Excessive forward drift:** `current > last_ts + MAX_TIMESTAMP_DRIFT_SECONDS` → returns
     `Err(Error::TimestampDrift)`.
3. Update the stored `LastTimestamp` to the validated value and return `Ok(current)`.

**Constants:**
- `MAX_TIMESTAMP_DRIFT_SECONDS = 7200` (2 hours). Any jump larger than this is treated as
  invalid, preventing cooldown bypass and price staleness miscalculation from extreme timestamps.

**Non-mutating calls** (`check_rebalance_needed`) read `env.ledger().timestamp()` directly
without updating `LastTimestamp`, since view functions must not have storage side-effects.

## Canonical Error Mapping: Contract → API

This table maps each contract error to the higher-level semantics that users and
backend/frontend layers observe. Consumers of the contract should use these numeric
codes for cross-layer correlation.

| Code | Contract Variant | Backend HTTP Status | Backend Error Code | User-Facing Meaning |
|---|---|---|---|---|
| `1` | `InvalidAllocation` | `400` | `VALIDATION_ERROR` | Target allocations must sum to 100%. |
| `2` | `RebalanceNotNeeded` | — | — | _Reserved; not currently emitted._ |
| `3` | `EmergencyStop` | `503` | `SERVICE_UNAVAILABLE` | Contract is paused by admin; no mutations allowed. |
| `4` | `CooldownActive` | `429` | `RATE_LIMITED` | Must wait 3600 s since last rebalance. |
| `5` | `StaleData` | `502` | `SERVICE_UNAVAILABLE` | Reflector oracle price data is stale. |
| `6` | `ExcessiveDrift` | — | — | _Reserved; not currently emitted._ |
| `7` | `AlreadyInitialized` | `409` | `CONFLICT` | Contract already initialized. |
| `8` | `InvalidThreshold` | `400` | `VALIDATION_ERROR` | Rebalance threshold must be 1–50. |
| `9` | `InvalidSlippageTolerance` | `400` | `VALIDATION_ERROR` | Slippage tolerance must be 10–500 bps. |
| `10` | `SlippageExceeded` | `400` | `VALIDATION_ERROR` | Post-trade execution exceeds the portfolio's slippage tolerance. |
| `11` | `TooManyAssets` | `400` | `VALIDATION_ERROR` | Portfolio exceeds maximum of 10 assets. |
| `12` | `TimestampDrift` | `400` | `VALIDATION_ERROR` | Ledger timestamp moved backward or jumped more than 7200 s. |
| `13` | `InvalidAmount` | `400` | `VALIDATION_ERROR` | Deposit amount must be positive. |
| `14` | `MissingPriceData` | `502` | `SERVICE_UNAVAILABLE` | Reflector oracle returned no price for an asset. |

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

- `Asset` (`contracts/src/reflector.rs`)
  - Enum: `Stellar(Address)` or `Other(Symbol)`.
- `PriceData` (`contracts/src/reflector.rs`)
  - Struct with `price: i128` and `timestamp: u64`.

For call builders and generated client bindings, use Soroban CLI/SDK tooling against the compiled WASM artifact.
