# Portfolio Rebalancer Contract ABI

Contract source:
- `contracts/src/lib.rs`
- `contracts/src/types.rs`
- `contracts/src/reflector.rs`

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
  - `rebalance_threshold`: Drift threshold percent (`1..=50`).
  - `slippage_tolerance`: Slippage tolerance in basis points (`10..=500`).
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

### `deposit(env: Env, portfolio_id: u64, asset: Address, amount: i128) -> ()`

- **Purpose:** Deposits an amount into `current_balances` for a portfolio and emits `("portfolio","deposit")`.
- **Parameters:**
  - `portfolio_id`: Target portfolio.
  - `asset`: Asset address key used in `current_balances`.
  - `amount`: Amount to add.
- **Returns:** No return value.
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
  - Missing price for an asset is skipped in drift comparison for that asset.

### `execute_rebalance(env: Env, portfolio_id: u64, actual_balances: Map<Address, i128>) -> Result<(), Error>`

- **Purpose:** Validates post-trade balances against slippage tolerance, updates `last_rebalance`, and emits `("portfolio","rebalanced")`.
- **Parameters:**
  - `portfolio_id`: Portfolio to rebalance.
  - `actual_balances`: Actual balances used for slippage checks.
- **Returns:** `Ok(())` or `Err(Error::SlippageExceeded)`.
- **Preconditions / failure behavior:**
  - Emergency stop must be off (otherwise panic `"Emergency stop active"`).
  - Portfolio must exist and owner must authorize call.
  - Cooldown must be elapsed (`>= 3600` seconds since last rebalance) or panic `"Cooldown active"`.
  - Every target asset must have non-stale Reflector price data or panic:
    - `"Stale price data"`
    - `"Missing price data"`

### `set_emergency_stop(env: Env, stop: bool) -> ()`

- **Purpose:** Toggles emergency stop flag in instance storage.
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
| `4` | `CooldownActive` | Reserved variant; cooldown path currently panics instead of returning this error. |
| `5` | `StaleData` | Reserved variant; stale-price path currently panics instead of returning this error. |
| `6` | `ExcessiveDrift` | Reserved variant; currently not explicitly returned by `lib.rs`. |
| `7` | `AlreadyInitialized` | `initialize` called after contract already initialized. |
| `8` | `InvalidThreshold` | `create_portfolio` threshold outside `1..=50`. |
| `9` | `InvalidSlippageTolerance` | `create_portfolio` slippage tolerance outside `10..=500`. |
| `10` | `SlippageExceeded` | `execute_rebalance` computed slippage above portfolio tolerance. |
| `11` | `TooManyAssets` | `create_portfolio` target allocation size above `MAX_PORTFOLIO_ASSETS`. |

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
- `Asset` (`contracts/src/reflector.rs`)
  - Enum: `Stellar(Address)` or `Other(Symbol)`.
- `PriceData` (`contracts/src/reflector.rs`)
  - Struct with `price: i128` and `timestamp: u64`.

For call builders and generated client bindings, use Soroban CLI/SDK tooling against the compiled WASM artifact.
