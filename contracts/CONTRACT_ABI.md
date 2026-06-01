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

### `check_invariants(env: Env, portfolio_id: u64) -> Result<(), Error>`

- **Purpose:** On-demand validation of core portfolio assumptions (allocations, thresholds, non-negative balances, active state).
- **Parameters:** `portfolio_id`.
- **Returns:** `Ok(())` when invariants hold, or `Err(Error::InvariantViolation)`, `Err(Error::PortfolioInactive)`, or `Err(Error::PortfolioNotFound)`.

### `deposit(env: Env, portfolio_id: u64, asset: Address, amount: i128) -> Result<(), Error>`

- **Purpose:** Deposits an amount into `current_balances` for a portfolio and emits `("portfolio","deposit")` with payload `(portfolio_id, asset, amount)`.
- **Parameters:**
  - `portfolio_id`: Target portfolio.
  - `asset`: Asset address key used in `current_balances`.
  - `amount`: Amount to add.
- **Returns:** `Ok(())` or an error variant.
- **Preconditions / failure behavior:**
  - `amount > 0` or `Err(Error::InvalidWithdrawAmount)`.
  - Emergency stop must be off or `Err(Error::EmergencyStop)`.
  - Portfolio must exist or `Err(Error::PortfolioNotFound)`.
  - Portfolio owner authorization required (`portfolio.user.require_auth()`).

### `withdraw(env: Env, portfolio_id: u64, asset: Address, amount: i128) -> Result<(), Error>`

- **Purpose:** Withdraws an amount from `current_balances`, deactivates the portfolio when all balances reach zero, and emits `("portfolio","withdraw")` with payload `(portfolio_id, asset, amount)`.
- **Parameters:** Same shape as `deposit`.
- **Returns:** `Ok(())` or `Err(Error::InsufficientBalance)`, `Err(Error::InvalidWithdrawAmount)`, `Err(Error::EmergencyStop)`, `Err(Error::PortfolioNotFound)`, or invariant errors.
- **Preconditions:**
  - `amount > 0` and `current_balance >= amount`.
  - Portfolio owner authorization required.

### `check_rebalance_needed(env: Env, portfolio_id: u64) -> bool`

- **Purpose:** Computes current drift versus target allocations using Reflector prices.
- **Parameters:** `portfolio_id`.
- **Returns:** `true` when any tracked asset drift exceeds `rebalance_threshold`, else `false`.
- **Preconditions / failure behavior:**
  - Portfolio and `ReflectorAddress` must exist in storage (panics on missing values).
  - Missing price for an asset is skipped in drift comparison for that asset.

### `execute_rebalance(env: Env, portfolio_id: u64, actual_balances: Map<Address, i128>) -> Result<(), Error>`

- **Purpose:** Validates post-trade balances against slippage tolerance, updates `last_rebalance`, and emits `("portfolio","rebalanced")` with payload `(portfolio_id, timestamp)`.
- **Parameters:**
  - `portfolio_id`: Portfolio to rebalance.
  - `actual_balances`: Actual balances used for slippage checks.
- **Returns:** `Ok(())` or `Err(Error::SlippageExceeded)`, `Err(Error::CooldownActive)`, `Err(Error::StaleData)`, `Err(Error::EmergencyStop)`.
- **Preconditions / failure behavior:**
  - Emergency stop must be off.
  - Portfolio must exist and owner must authorize call.
  - Cooldown must be elapsed (`>= REBALANCE_COOLDOWN_SECONDS`, 3600) or `Err(Error::CooldownActive)`.
  - Every target asset must have non-stale Reflector price data or `Err(Error::StaleData)`.

### `admin_force_rebalance(env: Env, portfolio_id: u64, actual_balances: Map<Address, i128>) -> Result<(), Error>`

- **Purpose:** Admin-only rebalance that bypasses the user cooldown, emits `("portfolio","cooldown_override")` with `(portfolio_id, admin, timestamp)`, then emits the standard rebalanced event.
- **Parameters:** Same as `execute_rebalance`.
- **Returns:** Same error set as `execute_rebalance` except cooldown is not enforced.
- **Preconditions:** Admin address in `DataKey::Admin` must authorize the call.

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
| `3` | `EmergencyStop` | `deposit`, `withdraw`, or rebalance while emergency stop is active. |
| `4` | `CooldownActive` | `execute_rebalance` called before cooldown elapses. |
| `5` | `StaleData` | Rebalance when Reflector price data is missing or stale. |
| `6` | `ExcessiveDrift` | Reserved variant; currently not explicitly returned by `lib.rs`. |
| `7` | `AlreadyInitialized` | `initialize` called after contract already initialized. |
| `8` | `InvalidThreshold` | `create_portfolio` threshold outside `1..=50`. |
| `9` | `InvalidSlippageTolerance` | `create_portfolio` slippage tolerance outside `10..=500`. |
| `10` | `SlippageExceeded` | `execute_rebalance` computed slippage above portfolio tolerance. |
| `11` | `TooManyAssets` | `create_portfolio` target allocation size above `MAX_PORTFOLIO_ASSETS`. |
| `12` | `InsufficientBalance` | `withdraw` amount exceeds `current_balances` for the asset. |
| `13` | `InvariantViolation` | `check_invariants` or pre-mutation invariant validation failed. |
| `14` | `PortfolioNotFound` | Unknown `portfolio_id`. |
| `15` | `PortfolioInactive` | Operation requires an active portfolio (`is_active == true`). |
| `16` | `InvalidWithdrawAmount` | `withdraw` or `deposit` with non-positive `amount`. |

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
