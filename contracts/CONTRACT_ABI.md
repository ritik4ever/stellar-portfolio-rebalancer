# Portfolio Rebalancer Contract ABI

Contract source:

- `contracts/src/lib.rs`
- `contracts/src/types.rs`
- `contracts/src/portfolio.rs`
- `contracts/src/templates.rs`
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

### `propose_admin(env: Env, new_admin: Address) -> Result<(), Error>`

- **Purpose:** Step 1 of the two-step admin transfer — nominates `new_admin` as the pending admin and emits `admin_proposed`.
- **Auth:** Requires auth from the current admin (`DataKey::Admin`).
- **Parameters:**
  - `new_admin`: address nominated to take over the admin role.
- **Errors:**
  - `InvalidAdminProposal` (39) when `new_admin` is already the current admin.
- **Notes:**
  - Nomination alone grants nothing: every admin-gated entrypoint keeps reading `DataKey::Admin`, which is only rewritten by `accept_admin`.
  - Calling it again **replaces** a proposal still in flight, so the current admin can retarget — or effectively cancel — a mistaken nomination by proposing a different address.
  - This is the only path that changes the admin after `initialize`; there is no single-call `set_admin`.

### `accept_admin(env: Env) -> Result<(), Error>`

- **Purpose:** Step 2 of the two-step admin transfer — the pending admin claims the role. Rewrites `DataKey::Admin`, clears `DataKey::PendingAdmin`, and emits `admin_transferred`.
- **Auth:** Requires auth from the address stored by `propose_admin`; any other caller fails the invocation. Requiring the incoming admin to sign is what proves the key is controllable, so a handover can never complete against a typo'd or unusable address.
- **Errors:**
  - `NoPendingAdmin` (38) when no transfer is in flight (never proposed, or already accepted).
- **Notes:**
  - The previous admin loses every admin right the moment this returns.
  - Not replayable — the nomination is consumed, so a second call returns `NoPendingAdmin`.

### `get_pending_admin(env: Env) -> Option<Address>`

- **Purpose:** Reads the address nominated by `propose_admin` and still awaiting its `accept_admin` call.
- **Returns:** `Some(address)` while a transfer is in flight, `None` otherwise.
- **Notes:**
  - Lets clients and monitoring surface a pending governance handover before it takes effect.

### `create_portfolio(env: Env, user: Address, target_allocations: Map<Address, u32>, asset_decimals: Map<Address, u32>, rebalance_threshold: u32, slippage_tolerance: u32, slippage_policy_version: u32) -> Result<u64, Error>`

- **Purpose:** Creates a new user portfolio (with default `StrategyType::Threshold` strategy) and emits a `("portfolio","created")` event.
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

### `create_portfolio_with_strategy(env: Env, user: Address, target_allocations: Map<Address, u32>, asset_decimals: Map<Address, u32>, rebalance_threshold: u32, slippage_tolerance: u32, slippage_policy_version: u32, strategy: StrategyType, strategy_config: StrategyConfig) -> Result<u64, Error>`

- **Purpose:** Creates a new user portfolio with an explicit rebalancing strategy and emits a `("portfolio","created")` event.
- **Parameters:**
  - Same as `create_portfolio` plus:
  - `strategy`: `StrategyType` enum — `Threshold (0)`, `Periodic (1)`, `Volatility (2)`, or `Custom (3)`.
  - `strategy_config`: `StrategyConfig` struct with fields `interval_seconds`, `volatility_threshold_bps`, `min_interval_seconds`.
- **Returns:** Same as `create_portfolio`.

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

### `create_template(env: Env, name: String, allocations: Map<Address, u32>) -> Result<(), Error>`

- **Purpose:** Admin-only: stores a new named on-chain allocation template. Templates
  are persistent contract storage, not hardcoded contract logic, so new named
  presets (e.g. "Conservative", "Balanced", "Aggressive") can be added or
  changed without a contract upgrade.
- **Parameters:**
  - `name`: Template name; must not already be in use.
  - `allocations`: Target allocations per asset (`Address -> percentage`), same shape and validation as `create_portfolio`'s `target_allocations`.
- **Returns:** `Ok(())` or one of:
  - `Err(Error::InvalidAllocation)` — allocations do not sum to 100% or contain a zero percentage.
  - `Err(Error::TooManyAssets)` — the allocation map has more than `MAX_PORTFOLIO_ASSETS` (10) entries, same limit `create_portfolio` enforces.
  - `Err(Error::PortfolioStorageFootprintTooLarge)` — a portfolio instantiated from this template would exceed `MAX_PORTFOLIO_STORAGE_BYTES`, estimated using default asset decimals and no balances yet (a lower bound on the real footprint).
  - `Err(Error::TemplateAlreadyExists)` — a template with this name already exists; use `update_template` instead.
  - `Err(Error::TooManyTemplates)` — the template registry already holds `MAX_TEMPLATES` (50) entries.
- **Preconditions:** `admin.require_auth()` succeeds.
- **Notes:** These limits exist so a template accepted here can, under normal use, be turned into a portfolio later via `create_portfolio_from_template` without hitting `create_portfolio`'s own asset-count and storage-footprint checks. This is not an absolute guarantee: the footprint estimate here assumes `asset_decimals` at portfolio-creation time has exactly one entry per allocated asset (as `create_portfolio_from_template`'s own `asset_decimals` parameter normally would). Since decimal *values* are fixed-width and don't affect the serialized size, only the number of `asset_decimals` entries matters — a caller who supplies extra, unrelated entries in `asset_decimals` at `create_portfolio_from_template` time can still exceed `MAX_PORTFOLIO_STORAGE_BYTES` despite the template having been accepted here.

### `update_template(env: Env, name: String, allocations: Map<Address, u32>) -> Result<(), Error>`

- **Purpose:** Admin-only: replaces the allocations of an existing named template.
- **Parameters:** Same as `create_template`.
- **Returns:** `Ok(())` or one of:
  - `Err(Error::InvalidAllocation)`
  - `Err(Error::TooManyAssets)`
  - `Err(Error::PortfolioStorageFootprintTooLarge)`
  - `Err(Error::TemplateNotFound)` — no template with this name exists; use `create_template` instead.
- **Preconditions:** `admin.require_auth()` succeeds.

### `get_template(env: Env, name: String) -> Option<Map<Address, u32>>`

- **Purpose:** Public read-only view of a template's stored allocations.
- **Returns:** `Some(allocations)` if the template exists, `None` otherwise.
- **Preconditions:** None; callable without signing.

### `list_templates(env: Env) -> Vec<String>`

- **Purpose:** Public read-only view of all known template names, in creation order.
- **Preconditions:** None; callable without signing.

### `create_portfolio_from_template(env: Env, user: Address, template_name: String, asset_decimals: Map<Address, u32>, rebalance_threshold: u32, slippage_tolerance: u32, slippage_policy_version: u32) -> Result<u64, Error>`

- **Purpose:** Creates a new user portfolio using the allocations stored under a named
  template instead of passing `target_allocations` directly. Shares the same
  validation, storage-footprint checks, and `("portfolio","created")` event
  emission as `create_portfolio`.
- **Parameters:** Same as `create_portfolio`, except `target_allocations` is replaced by `template_name`.
- **Returns:** `Ok(portfolio_id)` or any error `create_portfolio` can return, plus:
  - `Err(Error::TemplateNotFound)` — no template with this name exists.
- **Preconditions:**
  - `user.require_auth()` succeeds.
  - A template named `template_name` exists.

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
| `28` | `InvalidAllocationSum` | A portfolio's target allocations no longer sum to exactly 100% at rebalance time. | Update the portfolio's target allocations so they sum to exactly 100% before retrying. |
| `29` | `BatchTooLarge` | `batch_rebalance` was called with more than `MAX_BATCH_REBALANCE_PORTFOLIOS` (10) portfolio IDs. | Split the batch into groups of 10 or fewer portfolio IDs per call. |
| `30` | `InvalidOracleAddress` | The address passed to `initialize` as `reflector_address` does not behave like a Reflector oracle (its `base()` call failed or returned unexpectedly). | Verify the Reflector contract address is correct and deployed on the target network before calling `initialize`. |
| `31` | `TemplateNotFound` | `update_template` or `create_portfolio_from_template` referenced a template name that does not exist. | Call `list_templates` to see available names, or `create_template` first. |
| `32` | `TemplateAlreadyExists` | `create_template` was called with a name that is already in use. | Use `update_template` to change an existing template, or choose a different name. |
| `33` | `TooManyTemplates` | The template registry already holds `MAX_TEMPLATES` (50) entries. | There is no delete entrypoint. Repurpose an existing template's allocations via `update_template` instead of creating a new one. |
| `38` | `NoPendingAdmin` | `accept_admin` was called while no admin transfer is in flight. | Have the current admin call `propose_admin` first, or check `get_pending_admin` before accepting. |
| `39` | `InvalidAdminProposal` | `propose_admin` was called with the address that is already the current admin. | Propose a different address; re-proposing the incumbent would be a no-op transfer. |

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
  - `strategy: StrategyType` — rebalancing strategy (`Threshold`, `Periodic`, `Volatility`, `Custom`)
  - `strategy_config: StrategyConfig` — per-strategy parameters
- `StrategyType` (`contracts/src/types.rs`)
  - Enum: `Threshold = 0`, `Periodic = 1`, `Volatility = 2`, `Custom = 3`
  - Mirrors backend `RebalanceStrategyType` (excluding `dca`, which is handled separately)
- `StrategyConfig` (`contracts/src/types.rs`)
  - Struct: `interval_seconds: u64`, `volatility_threshold_bps: u32`, `min_interval_seconds: u64`
  - Default: 7-day interval, 10% volatility threshold, 1-day minimum interval
- `LegacyPortfolio` (`contracts/src/types.rs`)
  - Pre-strategy schema Portfolio struct used for on-read migration of existing stored portfolios
- `ContractCapabilitySummary` (`contracts/src/types.rs`)
  - Struct with `version: u32`, `schema_version: u32`, `capability_flags: u32`, `min_rebalance_threshold: u32`, `max_rebalance_threshold: u32`, `min_slippage_tolerance_bps: u32`, `max_slippage_tolerance_bps: u32`, `max_portfolio_assets: u32`.
- `Asset` (`contracts/src/reflector.rs`)
  - Enum: `Stellar(Address)` or `Other(Symbol)`.
- `PriceData` (`contracts/src/reflector.rs`)
  - Struct with `price: i128` and `timestamp: u64`.

For call builders and generated client bindings, use Soroban CLI/SDK tooling against the compiled WASM artifact.

## Property-Based Tests (`contracts/src/property_tests.rs`)

The contract includes a comprehensive property-based test suite using the
[`proptest`](https://docs.rs/proptest) crate. These tests verify invariant
properties across **10 000 random input combinations** each.

### Properties Tested

| # | Property | Description | Cases |
|---|----------|-------------|-------|
| 1 | **Allocation sum invariance** | Target allocations always sum to exactly `ALLOCATION_DENOMINATOR` (10 000 bps). Creating a portfolio with valid allocations always succeeds. | 10 000 |
| 2 | **Drift range** | Current allocation percentage and drift are always in `[0, 10000]` range. Portfolio valuation fields are within valid bounds. | 10 000 |
| 3 | **Rebalance idempotency** | When no rebalance is needed (drift within threshold), the portfolio state is stable — executing a rebalance does not change state. If rebalance IS needed, one execution brings portfolio into a stable state requiring no further rebalance. | 10 000 |
| 4 | **Deposit-withdraw roundtrip** | Depositing an amount and immediately withdrawing the same amount restores the original user balance. Internal portfolio balance returns to zero. | 10 000 |
| 5 | **Random allocation validity** | Any randomly generated allocation that sums to 10 000 bps and has 2–10 assets is accepted. Stored allocations match input exactly, and portfolio invariants hold. | 10 000 |

### Running Property Tests

```bash
# Run all property tests (50 000 total cases, ~3–5 minutes)
cd contracts
make test-property

# Or directly:
cargo test --features testutils property_ -- --nocapture
```

### CI Integration

The property test suite runs in CI as part of the contract test pipeline.
Test reports are uploaded as CI artifacts for regression analysis.

### Random Seed Reproducibility

Each proptest run logs the random seed used. To reproduce a specific failure:

```bash
PROPTEST_SEED=<hex-seed> cargo test --features testutils property_
```

## Property-Based Tests (`contracts/src/property_tests.rs`)

The contract includes property-based tests using [`proptest`](https://docs.rs/proptest) with **10,000 random inputs per property**.

| # | Property | Cases |
|---|----------|-------|
| 1 | Valid allocations (sum=10000) always accepted | 10,000 |
| 2 | Invalid allocations (sum!=10000) rejected | 10,000 |
| 3 | Deposit+withdraw roundtrip preserves balance | 10,000 |
| 4 | Drift and current_pct in [0,10000] range | 10,000 |
| 5 | Rebalance idempotent when no drift | 10,000 |

Run: `cargo test --features testutils property_`
