# Portfolio Rebalancer Contract ABI

Contract source:
- `contracts/src/lib.rs`
- `contracts/src/types.rs`
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

### `create_portfolio(env: Env, user: Address, target_allocations: Map<Address, u32>, rebalance_threshold: u32, slippage_tolerance: u32) -> Result<u64, Error>`

- **Purpose:** Creates a new user portfolio and emits a `("portfolio","created")` event.
- **Parameters:**
  - `user`: Portfolio owner; must authorize this call.
  - `target_allocations`: Target allocations per asset (`Address -> percentage`).
  - `rebalance_threshold`: Drift threshold percent (must be between `MIN_REBALANCE_THRESHOLD` and `MAX_REBALANCE_THRESHOLD`, i.e., `1..=50`).
  - `slippage_tolerance`: Slippage tolerance in basis points (must be between `MIN_SLIPPAGE_TOLERANCE_BPS` and `MAX_SLIPPAGE_TOLERANCE_BPS`, i.e., `10..=500`).
- **Returns:** `Ok(portfolio_id)` or one of:
  - `Err(Error::InvalidAllocation)`
  - `Err(Error::TooManyAssets)`
  - `Err(Error::InvalidThreshold)`
  - `Err(Error::InvalidSlippageTolerance)`
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

### `deposit(env: Env, portfolio_id: u64, asset: Address, amount: i128, memo: String) -> ()`

- **Purpose:** Deposits an amount into `current_balances` for a portfolio and emits `("portfolio","deposit")`.
- **Parameters:**
  - `portfolio_id`: Target portfolio.
  - `asset`: Asset address key used in `current_balances`.
  - `amount`: Amount to add (must be positive).
  - `memo`: Optional memo string for correlating deposits outside the contract (e.g., deposit reference IDs). Pass an empty string if unused.
- **Returns:** No return value.
- **Event payload:** `(portfolio_id: u64, asset: Address, amount: i128, memo: String)`
- **Preconditions / failure behavior:**
  - `amount > 0` (otherwise panic `"Amount must be positive"`).
  - Emergency stop must be off (otherwise panic `"Emergency stop active"`).
  - Portfolio must exist (otherwise panic on `.unwrap()`).
  - Portfolio owner authorization required (`portfolio.user.require_auth()`).

### `check_rebalance_needed(env: Env, portfolio_id: u64) -> bool`

- **Purpose:** Computes current drift versus target allocations using Reflector prices.
- **Parameters:** `portfolio_id`.
- **Returns:** `true` when any tracked asset drift exceeds `rebalance_threshold`, else `false`.
- **Preconditions / failure behavior:**
  - Portfolio and `ReflectorAddress` must exist in storage (panics on missing values).
  - Reflector timeout/unavailability semantics: if any held asset has missing or stale price data, the function returns `false` because a deterministic rebalance decision cannot be made.
  - Price data is stale when `ledger.timestamp - price.timestamp > 3600` seconds.

### `execute_rebalance(env: Env, portfolio_id: u64, actual_balances: Map<Address, i128>) -> Result<(), Error>`

- **Purpose:** Validates post-trade balances against slippage tolerance, updates `last_rebalance`, and emits `("portfolio","rebalanced")`.
- **Parameters:**
  - `portfolio_id`: Portfolio to rebalance.
  - `actual_balances`: Actual balances used for slippage checks.
- **Returns:** `Ok(())`, `Err(Error::SlippageExceeded)`, or `Err(Error::StaleData)`.
- **Preconditions / failure behavior:**
  - Emergency stop must be off (otherwise panic `"Emergency stop active"`).
  - Portfolio must exist and owner must authorize call.
  - Cooldown must be elapsed (`>= 3600` seconds since last rebalance) or panic `"Cooldown active"`.
  - Every target asset must have Reflector price data with timestamp no more than 3600 seconds older than the current ledger timestamp.
  - Reflector timeout/unavailability semantics: missing price data and stale price data both return `Err(Error::StaleData)`. The portfolio is not updated and no `("portfolio","rebalanced")` event is emitted.

### `set_emergency_stop(env: Env, stop: bool) -> ()`

- **Purpose:** Toggles emergency stop flag in instance storage.
- **Parameters:** `stop` boolean.
- **Returns:** No return value.
- **Preconditions:**
  - Admin address stored in `DataKey::Admin` must authorize the call.

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

## Error Codes (`contracts/src/types.rs`)

`Error` is declared with `#[repr(u32)]`, so values are stable numeric codes:

| Code | Variant | Returned when |
|---|---|---|
| `1` | `InvalidAllocation` | `create_portfolio` receives allocation map that fails validation. |
| `2` | `RebalanceNotNeeded` | Reserved variant; currently not explicitly returned by `lib.rs`. |
| `3` | `EmergencyStop` | Reserved variant; emergency-stop paths currently panic instead of returning this error. |
| `4` | `CooldownActive` | Reserved variant; cooldown path currently panics instead of returning this error. |
| `5` | `StaleData` | `execute_rebalance` cannot read current Reflector data: at least one target asset price is missing or older than 3600 seconds. |
| `6` | `ExcessiveDrift` | Reserved variant; currently not explicitly returned by `lib.rs`. |
| `7` | `AlreadyInitialized` | `initialize` called after contract already initialized. |
| `8` | `InvalidThreshold` | `create_portfolio` threshold outside `MIN_REBALANCE_THRESHOLD..=MAX_REBALANCE_THRESHOLD` (i.e., `1..=50`). |
| `9` | `InvalidSlippageTolerance` | `create_portfolio` slippage tolerance outside `MIN_SLIPPAGE_TOLERANCE_BPS..=MAX_SLIPPAGE_TOLERANCE_BPS` (i.e., `10..=500`). |
| `10` | `SlippageExceeded` | `execute_rebalance` computed slippage above portfolio tolerance. |
| `11` | `TooManyAssets` | `create_portfolio` target allocation size above `MAX_PORTFOLIO_ASSETS`. |
| `12` | `FeeTooHigh` | Reserved variant; fee validation currently panics instead of returning this error. |
| `13` | `NotAllowed` | Reserved variant; authorization failures currently panic instead of returning this error. |
| `14` | `UpgradeFailed` | Reserved variant; upgrade failures currently panic instead of returning this error. |

## XDR/Contract Type References

The contract uses Soroban contract types (`#[contracttype]`) which are encoded as Soroban `ScVal`/XDR values over RPC.

- `Address` (`soroban_sdk::Address`)
  - Used for users, assets, and external contract references.
- `Map<Address, u32>`
  - Used for `target_allocations` where value is target percentage.
- `Map<Address, i128>`
  - Used for `current_balances` and `actual_balances`.
- `Portfolio` (`contracts/src/types.rs`)
  - Composite struct:
  - `user: Address`
  - `target_allocations: Map<Address, u32>`
  - `current_balances: Map<Address, i128>`
  - `rebalance_threshold: u32`
  - `slippage_tolerance: u32`
  - `last_rebalance: u64`
  - `total_value: i128`
  - `is_active: bool`
- `FeeConfig` (`contracts/src/types.rs`)
  - Struct: `fee_bps: u32` (fee in basis points, max 1000 when enabled), `fee_recipient: Address`, `enabled: bool`.
- `UpgradeEvent` (`contracts/src/types.rs`)
  - Struct: `from_hash: Bytes` (previous WASM hash, empty if first upgrade), `to_hash: Bytes` (new WASM hash), `timestamp: u64`.
- `Asset` (`contracts/src/reflector.rs`)
  - Enum: `Stellar(Address)` or `Other(Symbol)`.
- `PriceData` (`contracts/src/reflector.rs`)
  - Struct with `price: i128` and `timestamp: u64`.

For call builders and generated client bindings, use Soroban CLI/SDK tooling against the compiled WASM artifact.
