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

- **Returns:** No return value.
- **Event payload:** `(portfolio_id: u64, asset: Address, amount: i128, memo: String)`
- **Preconditions / failure behavior:**
  - `amount > 0` (otherwise panic `"Amount must be positive"`).
  - Emergency stop must be off (otherwise panic `"Emergency stop active"`).
  - Portfolio must be active (otherwise panic `"Portfolio paused"`).
  - Portfolio must exist (otherwise panic on `.unwrap()`).
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
- **Purpose:** Validates post-trade balances against slippage tolerance (per `slippage_policy_version` on the portfolio), updates `last_rebalance`, and emits `("portfolio","rebalanced")`.
- **Parameters:**
  - `portfolio_id`: Portfolio to rebalance.
  - `actual_balances`: Actual balances used for slippage checks.
- **Returns:** `Ok(())` or one of:

  - `Err(Error::CooldownActive)`
  - `Err(Error::StaleData)`
  - `Err(Error::SlippageExceeded)`
- **Preconditions / failure behavior:**
  - Emergency stop must be off (otherwise returns `Err(Error::EmergencyStop)`).
  - Portfolio must exist and owner must authorize call.


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

### `preview_rebalance(env: Env, portfolio_id: u64) -> RebalancePreview`

- **Purpose:** Non-mutating preview that computes planned trades, skipped assets, and threshold decisions for a portfolio without executing the rebalance.
- **Returns:** `RebalancePreview` with trade details.
### `transfer_stewardship(env: Env, portfolio_id: u64, new_steward: Address) -> Result<(), Error>`

- **Purpose:** Transfers operational ownership of a single portfolio to a new address without changing the global contract admin.
- **Parameters:**
  - `portfolio_id`: Target portfolio.
  - `new_steward`: Address that will become the new steward.
- **Returns:** `Ok(())` on success.
- **Preconditions:**
  - Portfolio must exist.
  - Current steward (or portfolio user if no steward set) must authorize the call.
- **Events:** Publishes `("portfolio", "steward_transferred")` with `(portfolio_id, old_steward, new_steward)`.

### `get_steward(env: Env, portfolio_id: u64) -> Address`

- **Purpose:** Returns the steward address for a portfolio, falling back to the portfolio user if no steward has been set.
- **Parameters:** `portfolio_id`.
- **Returns:** `Address` of the current steward or portfolio user.

### `capabilities(env: Env) -> u32`

- **Purpose:** Returns a bitset of supported optional behaviors for frontend and backend compatibility checks.
- **Returns:** `u32` bitmask. Test with `flags & CapabilityFlag::X != 0`.
- **Defined flags:**
  - `PerPortfolioSteward = 1` — per-portfolio steward transfer is supported.
  - `DifferentiatedPricing = 2` — `calculate_portfolio_value` distinguishes stale, missing, and malformed prices.
  - `EmergencyStop = 4` — global emergency stop is supported.


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
| `12` | `Unauthorized` | Unauthorized operation. |
| `13` | `StalePrice` | `execute_rebalance` detected stale price data (>1 hour old). |
| `14` | `MissingPrice` | `execute_rebalance` cannot find price for a portfolio asset. |
| `15` | `MalformedPrice` | `execute_rebalance` received non-positive price value. |
| `16` | `PortfolioPaused` | Operation on a portfolio that has been paused. |
| `17` | `PreviewUnavailable` | Price data unavailable for rebalance preview. |
| `18` | `InvalidAssetDecimals` | `create_portfolio` asset decimals invalid. |
| `19` | `UnsupportedSlippagePolicyVersion` | `create_portfolio` with unsupported slippage version. |
| `20` | `AssetDecimalsMismatch` | Asset decimals mismatch in portfolio operations. |
| `21` | `InsufficientBalance` | `withdraw` amount exceeds `current_balances` for the asset. |
| `22` | `InvariantViolation` | `check_invariants` or pre-mutation invariant validation failed. |
| `23` | `PortfolioNotFound` | Unknown `portfolio_id`. |
| `24` | `PortfolioInactive` | Operation requires an active portfolio (`is_active == true`). |
| `25` | `InvalidWithdrawAmount` | `withdraw` or `deposit` with non-positive `amount`. |

## Valuation Errors (`contracts/src/portfolio.rs`)

`ValuationError` is a non-contract-internal enum returned by `calculate_portfolio_value`:

| Code | Variant | Meaning |
|---|---|---|
| `1` | `StaleData` | Price data is older than 1-hour freshness window. |
| `2` | `MissingPrice` | No price available for an asset from the Reflector oracle. |
| `3` | `MalformedData` | Price value is zero or negative. |

## Capability Flags

`CapabilityFlag` is an enum whose values map to bit positions in the `u32` returned by `capabilities()`:

| Bit | Flag | Description |
|---|---|---|
| `1` | `PerPortfolioSteward` | Per-portfolio steward transfer is supported (`transfer_stewardship`, `get_steward`). |
| `2` | `DifferentiatedPricing` | Pricing errors distinguish stale/missing/malformed (`ValuationError`). |
| `4` | `EmergencyStop` | Global emergency stop is supported (`set_emergency_stop`). |

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
