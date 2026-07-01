# Portfolio Rebalancer Contract ABI

Contract source:

- `contracts/src/lib.rs`
- `contracts/src/types.rs`
- `contracts/src/portfolio.rs`
- `contracts/src/reflector.rs`

For common invocation examples and debugging commands, see the [Soroban Cookbook](../docs/soroban-cookbook.md).
For main domain terms used in this contract, see [docs/GLOSSARY.md](../docs/GLOSSARY.md).

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

### `get_admin(env: Env) -> Address`

- **Purpose:** Reads the configured admin address from contract instance storage.
- **Parameters:**
  - `env`: Soroban execution environment.
- **Returns:** Stored admin `Address`.
- **Notes:**
  - External clients can use this to confirm the configured governance/admin address before invoking privileged actions.

### `create_portfolio(env: Env, user: Address, target_allocations: Map<Address, u32>, asset_decimals: Map<Address, u32>, rebalance_threshold: u32, slippage_tolerance: u32, slippage_policy_version: u32) -> Result<u64, Error>`

- **Purpose:** Creates a new user portfolio and emits a `("portfolio","created")` event.
- **Parameters:**
  - `user`: Portfolio owner; must authorize this call.
  - `target_allocations`: Target allocations per asset (`Address -> percentage`).
  - `asset_decimals`: Decimal precision per asset (`Address -> decimals`).
  - `rebalance_threshold`: Drift threshold percent (`1..=50`).
  - `slippage_tolerance`: Slippage tolerance in basis points (`10..=500`).
  - `slippage_policy_version`: Policy version matching `CURRENT_SLIPPAGE_POLICY_VERSION`.
- **Returns:** `Ok(portfolio_id)` or one of:
  - `Err(Error::InvalidAllocation)`
  - `Err(Error::InvalidAssetDecimals)`
  - `Err(Error::TooManyAssets)`
  - `Err(Error::InvalidThreshold)`
  - `Err(Error::InvalidSlippageTolerance)`
  - `Err(Error::PortfolioStorageFootprintTooLarge)`
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

- **Purpose:** Checks internal consistency and structural invariants of a stored portfolio.
- **Parameters:** `portfolio_id` unique integer ID.
- **Returns:** `Ok(())` if valid, `Err(Error::InvariantViolation)` or `Err(Error::PortfolioNotFound)`.

### `deposit(env: Env, portfolio_id: u64, asset: Address, amount: i128, memo: String) -> Result<(), Error>`

- **Purpose:** Deposits an amount into `current_balances` for a portfolio and emits `("portfolio","deposit")`.
- **Parameters:**
  - `portfolio_id`: Target portfolio.
  - `asset`: Asset address key used in `current_balances`.
  - `amount`: Amount to add.
  - `memo`: Caller-supplied deposit memo included in the emitted event.
- **Returns:** `Ok(())` on success, or one of:
  - `Err(Error::InvalidWithdrawAmount)` — amount is zero or negative.
  - `Err(Error::EmergencyStop)` — contract is in emergency stop.
  - `Err(Error::PortfolioPaused)` — portfolio is inactive/paused.
- **Event payload:** `(portfolio_id: u64, asset: Address, amount: i128, memo: String)`
- **Preconditions / failure behavior:**
  - Portfolio must exist (otherwise returns `Error::PortfolioNotFound`).
  - Steward or portfolio owner authorization required (`steward.require_auth()`).

### `withdraw(env: Env, portfolio_id: u64, asset: Address, amount: i128) -> Result<(), Error>`

- **Purpose:** Withdraws an amount from `current_balances` for a portfolio and emits `("portfolio","withdraw")`.
- **Parameters:**
  - `portfolio_id`: Target portfolio.
  - `asset`: Asset address key used in `current_balances`.
  - `amount`: Amount to withdraw.
- **Returns:** `Ok(())` on success, or one of:
  - `Err(Error::InvalidWithdrawAmount)` — amount is zero or negative.
  - `Err(Error::EmergencyStop)` — contract is in emergency stop.
  - `Err(Error::InsufficientBalance)` — asset balance is less than requested amount.
- **Preconditions / failure behavior:**
  - Portfolio owner authorization required (`portfolio.user.require_auth()`).

### `check_rebalance_needed(env: Env, portfolio_id: u64) -> bool`

- **Purpose:** Computes current drift versus target allocations using Reflector prices.
- **Parameters:** `portfolio_id`.
- **Returns:** `true` when any tracked asset drift exceeds `rebalance_threshold`, else `false`.
- **Preconditions / failure behavior:**
  - Portfolio and `ReflectorAddress` must exist in storage (panics on missing values).
  - Reflector timeout/unavailability semantics: if any held asset has missing or stale price data, the function returns `false` because a deterministic rebalance decision cannot be made.

### `execute_rebalance(env: Env, portfolio_id: u64, actual_balances: Map<Address, i128>) -> Result<(), Error>`

- **Purpose:** Validates post-trade balances against slippage tolerance (per `slippage_policy_version` on the portfolio), updates `last_rebalance`, and emits `("portfolio","rebalanced")`.
- **Parameters:**
  - `portfolio_id`: Portfolio to rebalance.
  - `actual_balances`: Actual balances used for slippage checks.
- **Preconditions / failure behavior:**
  - Portfolio must exist and steward/owner must authorize call.

### `admin_force_rebalance(env: Env, portfolio_id: u64, actual_balances: Map<Address, i128>) -> Result<(), Error>`

- **Purpose:** Allows the admin to force execute a rebalance on a portfolio, bypassing the standard cooldown check. Emits `("portfolio","rebalanced")` and cooldown override events.
- **Parameters:**
  - `portfolio_id`: Portfolio to rebalance.
  - `actual_balances`: Actual balances used for slippage checks.
- **Preconditions:**
  - Admin address stored in `DataKey::Admin` must authorize the call.

### `set_emergency_stop(env: Env, stop: bool) -> ()`

- **Purpose:** Toggles emergency stop flag in instance storage and records `ContractPauseReason`.
- **Parameters:** `stop` boolean.
- **Returns:** No return value.
- **Preconditions:**
  - Admin address stored in `DataKey::Admin` must authorize the call.
  - The configured admin may be a multisig/governance contract address, as long as it authorizes via Soroban auth.

### `transfer_stewardship(env: Env, portfolio_id: u64, new_steward: Address) -> Result<(), Error>`

- **Purpose:** Transfers the stewardship of a portfolio to a new steward address. Emits `("portfolio","steward_transferred")`.
- **Parameters:**
  - `portfolio_id`: Target portfolio ID.
  - `new_steward`: New steward address.
- **Preconditions:**
  - Current steward (or portfolio owner if no steward set) must authorize the call.

### `get_steward(env: Env, portfolio_id: u64) -> Address`

- **Purpose:** Returns the configured steward address for a portfolio, defaulting to the portfolio owner if not explicitly set.

### `version(env: Env) -> u32`

- **Purpose:** Read-only capability surface returning the overall deployed contract logic version (`CONTRACT_VERSION`).
- **Returns:** `1`.
- **Usage:** Used by frontend and backend clients during startup and compatibility checks to verify contract compatibility cheaply without attempting writes.

### `schema_version(env: Env) -> u32`

- **Purpose:** Read-only capability surface returning the expected contract event schema version (`CONTRACT_EVENT_SCHEMA_VERSION`).
- **Returns:** `1`.
- **Usage:** Used by frontend and backend clients during startup and compatibility checks to ensure event parsers and indexers match the deployed event formats.

### `capabilities(env: Env) -> u32`

- **Purpose:** Read-only capability surface returning a bitmask representing active on-chain contract capabilities (`CapabilityFlag`).
- **Returns:** Bitmask containing flags for `PerPortfolioSteward`, `DifferentiatedPricing`, and `EmergencyStop`.
- **Usage:** Allows external callers to detect deployed contract capabilities cheaply before attempting writes.

### `capability_summary(env: Env) -> ContractCapabilitySummary`

- **Purpose:** Unified read-only capability surface that aggregates version, schema version, capability flags, and key configuration parameters into a single cheap read call.
- **Returns:** `ContractCapabilitySummary` struct containing `version`, `schema_version`, `capability_flags`, `min_rebalance_threshold`, `max_rebalance_threshold`, `min_slippage_tolerance_bps`, `max_slippage_tolerance_bps`, and `max_portfolio_assets`.
- **Usage:** Designed specifically for frontend and backend callers during startup and compatibility checks to confirm all supported contract limits and features in one query before attempting writes.

### `set_fee_config(env: Env, config: FeeConfig) -> ()`

- **Purpose:** Sets fee configuration for the contract. Disabled by default (`enabled: false`).
- **Parameters:**
  - `config`: `FeeConfig` struct with `fee_bps: u32`, `fee_recipient: Address`, `enabled: bool`.
- **Returns:** No return value.
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

- **Purpose:** Non-mutating simulation path for backend dry-run APIs. Returns a `RebalancePreview` struct detailing candidate trades, skipped assets, skip reasons, threshold decisions, and whether a rebalance is needed.
- **Parameters:**
  - `portfolio_id`: Portfolio to preview rebalance for.
- **Preconditions:**
  - Does not require portfolio owner authorization and does not mutate persistent storage.

### `pause_portfolio(env: Env, portfolio_id: u64, reason: PauseReason) -> ()`

- **Purpose:** Pauses a specific portfolio and records the pause reason.
- **Parameters:**
  - `portfolio_id`: Target portfolio ID.
  - `reason`: `PauseReason` enum value.

### `get_contract_pause_reason(env: Env) -> PauseReason`

- **Purpose:** Returns the current contract-level pause reason.
- **Returns:** `PauseReason` (defaults to `PauseReason::None` if active).

## Error Codes (`contracts/src/types.rs`)

`Error` is declared with `#[repr(u32)]`, so values are stable numeric codes:

| Code | Variant | Description | Recovery Action |
|------|---------|-------------|-----------------|
| `1` | `InvalidAllocation` | Target allocation percentages do not sum to 100% or individual allocations are zero. | Verify allocations in your `create_portfolio` call sum to exactly 100. Each asset must have a positive percentage. |
| `2` | `RebalanceNotNeeded` | No asset drift exceeds the portfolio's configured rebalance threshold. | This is informational — no action needed. Increase the threshold sensitivity if you want more frequent rebalancing. |
| `3` | `EmergencyStop` | Contract is in emergency stop mode; all state-mutating operations are blocked. | Wait for the admin to disable the emergency stop. Check the `set_emergency_stop` event logs for the reason code. |
| `4` | `CooldownActive` | A rebalance was executed too recently; the cooldown period has not elapsed. | Wait for the cooldown period to pass. |
| `5` | `StaleData` | Reflector oracle price data is stale or missing. | Retry after oracle data refreshes. Verify the Reflector contract address is correct and the oracle is operational. |
| `6` | `ExcessiveDrift` | Computed portfolio drift exceeds the allowed maximum. | Review your target allocations. Consider rebalancing in smaller steps or adjusting the rebalance threshold to a higher value. |
| `7` | `AlreadyInitialized` | The `initialize` function was called on an already-initialized contract. | No action needed — the contract is already set up. |
| `8` | `InvalidThreshold` | Rebalance threshold is outside the allowed range (1–50%). | Provide a `rebalance_threshold` between `MIN_REBALANCE_THRESHOLD` (1) and `MAX_REBALANCE_THRESHOLD` (50). |
| `9` | `InvalidSlippageTolerance` | Slippage tolerance is outside the allowed range (10–500 bps). | Provide a `slippage_tolerance` between `MIN_SLIPPAGE_TOLERANCE_BPS` (10) and `MAX_SLIPPAGE_TOLERANCE_BPS` (50). |
| `10` | `SlippageExceeded` | Post-trade balances deviated beyond the portfolio's configured slippage tolerance. | Increase `slippage_tolerance` on the portfolio or split the rebalance into smaller trades. Check market liquidity for the affected assets. |
| `11` | `TooManyAssets` | A portfolio's target allocation map exceeds `MAX_PORTFOLIO_ASSETS` (10). | Reduce the number of assets in the `target_allocations` map to 10 or fewer. |
| `12` | `StaleOraclePrice` | Reflector oracle price data is stale. | Retry after oracle data refreshes. |
| `13` | `InvalidAssetThreshold` | Asset threshold configuration is invalid. | Provide valid threshold configuration. |
| `14` | `InvariantViolation` | An internal contract invariant was violated — this indicates a bug. | Report this error with the full transaction envelope to the maintainers. Include the portfolio ID, contract version, and triggering operation. |
| `15` | `InvalidAssetDecimals` | An asset's decimal count exceeds `MAX_ASSET_DECIMALS` (18) or is otherwise invalid. | Verify the asset's decimal configuration. Stellar assets typically use 7 decimals; other assets may use up to 18. |
| `16` | `UnsupportedSlippagePolicyVersion` | The portfolio's `slippage_policy_version` is not recognized by the current contract version. | Upgrade the contract to a version that supports the portfolio's policy version, or recreate the portfolio with the current `CURRENT_SLIPPAGE_POLICY_VERSION`. |
| `17` | `InvalidWithdrawAmount` | The withdrawal or deposit amount is zero, negative, or invalid. | Provide a positive amount. |
| `18` | `PortfolioPaused` | The portfolio is in a paused state (user-paused, admin emergency, or circuit breaker). | Check the portfolio's `pause_reason` field to determine the cause. Admin can toggle emergency stop; user may need to unpause. |
| `19` | `InsufficientBalance` | The portfolio's current balance is insufficient for the requested operation. | Deposit additional funds into the portfolio before retrying the operation. Verify `current_balances` via `get_portfolio`. |
| `20` | `MissingPrice` | A required asset price could not be retrieved from the Reflector oracle. | Ensure the Reflector oracle contract is deployed and reachable. Verify the asset key matches the reflector's supported asset list. |
| `21` | `PortfolioNotFound` | The requested portfolio ID does not exist in persistent contract storage. | Verify the portfolio ID is correct. |
| `22` | `PortfolioStorageFootprintTooLarge` | The serialized portfolio struct exceeds `MAX_PORTFOLIO_STORAGE_BYTES` (3072 bytes). | Reduce the number of assets in the portfolio. Each asset adds to the storage footprint of the `target_allocations`, `current_balances`, and `asset_decimals` maps. |
| `23` | `PreviewUnavailable` | The simulation path cannot generate a rebalance preview due to missing data. | Ensure the Reflector oracle is returning price data for all portfolio assets. Retry the simulation when oracle data is available. |
| `24` | `InvalidCooldown` | The cooldown duration is invalid. | Provide a valid cooldown setting. |
| `25` | `AssetNotSupported` | An asset in the portfolio has no price data available from the Reflector oracle. | Verify the asset is listed in the Reflector oracle. Check the asset's contract address or Stellar issuer is correctly specified. |
| `26` | `InvalidAmount` | A deposit or trade amount is zero, negative, or below the minimum trade size. | Provide a positive amount greater than the minimum trade size. |
| `27` | `WithdrawFailed` | A withdrawal operation could not be completed. | Check that the portfolio has sufficient balance and is not paused. Verify the withdrawal amount does not exceed available balances. |

For common invocation examples and debugging commands, see the [Soroban Cookbook](../docs/soroban-cookbook.md).

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
- `ContractCapabilitySummary` (`contracts/src/types.rs`)
  - Struct with `version: u32`, `schema_version: u32`, `capability_flags: u32`, `min_rebalance_threshold: u32`, `max_rebalance_threshold: u32`, `min_slippage_tolerance_bps: u32`, `max_slippage_tolerance_bps: u32`, `max_portfolio_assets: u32`.
- `Asset` (`contracts/src/reflector.rs`)
  - Enum: `Stellar(Address)` or `Other(Symbol)`.
- `PriceData` (`contracts/src/reflector.rs`)
  - Struct with `price: i128` and `timestamp: u64`.

For call builders and generated client bindings, use Soroban CLI/SDK tooling against the compiled WASM artifact.
