# Glossary

This glossary defines the main terms used across the Stellar Portfolio Rebalancer repository, including frontend concepts, backend API patterns, and Soroban smart contract terminology.

## How to use this glossary

- New contributors should read this before working on contracts, backend features, or documentation.
- If you see a term in `README.md`, `docs/CONTRIBUTING.md`, or `contracts/CONTRACT_ABI.md`, this page explains it in plain language.
- Use the cross-links to jump to deeper references for contract invocation, API docs, and deployment guides.

## Key terms

### Portfolio
A **Portfolio** is the main user-owned object in the system. On-chain (Soroban contract) it stores:
- `user`: the portfolio owner's address (defaults to steward if no explicit steward is set)
- `target_allocations`: how the user wants funds split across assets (basis points, 0–10 000)
- `current_balances`: the actual balances currently held in each asset
- `asset_decimals`: decimal precision map for each tracked asset
- `rebalance_threshold`: the drift limit that triggers a rebalance (percentage, 1–50)
- `slippage_tolerance`: how much execution slippage is allowed (basis points, 10–500)
- `slippage_policy_version`: version identifier for the active slippage calculation policy
- `last_rebalance`: ledger timestamp of the most recent successful rebalance
- `total_value`: the portfolio's current USD-denominated value at last rebalance
- `strategy` / `strategy_config`: the active rebalancing strategy type and its parameters
- `is_active` / `pause_reason`: whether the portfolio is paused and why (None, UserPaused, AdminEmergency, VolatilityCircuitBreaker, CooldownActive)
- `circuit_breaker_config`: per-portfolio volatility circuit breaker settings (window + spike threshold)
- `global_max_slippage_bps`: portfolio-level override of the contract-wide maximum slippage cap (basis points)

In the backend/API layer, a Portfolio also carries: `id`, `userAddress`, `name`, `description`, `allocations` (percentages summing to 100), `threshold`, `slippageTolerance` / `slippageTolerancePercent`, `balances`, `totalValue`, `createdAt`, `lastRebalance`, `version`, and `riskPausedUntil`.

Each portfolio is capped at `MAX_PORTFOLIO_ASSETS` (10) assets, and each user at `MAX_PORTFOLIOS_PER_USER` (10) portfolios. In the smart contract, a portfolio is identified by a numeric `portfolio_id` returned by `create_portfolio`.

### Target allocation
`target_allocations` is a mapping of asset addresses to target percentages.
- **Backend/API layer:** Plain percentages summing to 100. Example: `{ "XLM": 40, "USDC": 35, "BTC": 25 }`
- **Smart contract layer:** Basis points (0–10 000) summing to `ALLOCATION_DENOMINATOR` (10 000). The backend transparently converts between the two representations when creating or syncing portfolios.
- The contract checks this during `create_portfolio` and rejects invalid allocations with `InvalidAllocation`.

### Rebalance threshold / drift threshold
Also called **threshold** in the UI and contract.
- A value between `1` and `50`.
- The contract uses this value to decide whether current asset weights have drifted far enough from targets to require a rebalance.
- The backend and frontend refer to this as `rebalance_threshold`.

### Slippage tolerance
The maximum allowed execution slippage. Represented differently across layers:
- **Smart contract layer:** Basis points (`10..=500`). Example: `50` means `0.50%` slippage is allowed. If executed balances fall outside this tolerance, `execute_rebalance` returns `SlippageExceeded`.
- **Backend/API layer:** Percentage values (`0.1..=5`). Example: `0.5` means `0.50%` slippage is allowed. The backend multiplies this by 100 before passing to the contract. API validation rejects values outside `0.1`–`5` percent, and the storage layer further clamps to `0.5`–`5` percent.

### Reflector oracle
**Reflector** is the price oracle contract used by the portfolio contract to fetch asset prices.
- The contract stores `reflector_address` during initialization.
- Price checks use this oracle for drift and rebalance validation.
- See `contracts/CONTRACT_ABI.md` and `docs/soroban-cookbook.md` for invoke examples.

### Asset
An asset is a token tracked inside a portfolio.
- The contract uses Soroban `Address` values to represent assets.
- In the backend and UI, common assets include `XLM`, `USDC`, and token addresses supported by Stellar wallets.

### Current balances
The contract stores a portfolio's `current_balances` as `Map<Address, i128>`.
- This map represents the actual amounts held in each asset.
- When the backend deposits funds or executes a rebalance, `current_balances` is updated accordingly.

### Total value
`total_value` is the portfolio's current value expressed in contract storage.
- It is typically derived from asset balances and oracle prices.
- The frontend shows this in the dashboard and performance views.

### Portfolio ID
A numeric `portfolio_id` returned by `create_portfolio`.
- Used by API routes such as `GET /api/v1/portfolio/:id` and contract calls like `execute_rebalance`.

### Steward
The address authorized to sign `execute_rebalance` and `deposit` calls for a specific portfolio.

- By default the steward is the portfolio owner (the `user` address supplied to `create_portfolio`).
- The owner can delegate stewardship to another address (a multisig, an automation contract, or a hot wallet) by calling `transfer_stewardship`.
- Only the current steward can authorize rebalance transactions for that portfolio. There is no way to rebalance a portfolio without the steward's active signature.
- See [`transfer_stewardship` in CONTRACT_ABI.md](../contracts/CONTRACT_ABI.md#transfer_stewardship) for the full function signature.

### Stewardship delegation
The act of transferring the steward role to a different address via `transfer_stewardship`.

- Use this when you want rebalancing to continue without your primary wallet (for example, via an automation service or multisig).
- Only the **current steward** can call `transfer_stewardship`. When no explicit steward has been set, the current steward defaults to the portfolio owner (`user` address). After delegation, only the newly appointed steward can re-delegate.
- To revoke a delegation, the current steward calls `transfer_stewardship` again with the owner's address as `new_steward`.
- Call `get_steward(portfolio_id)` to read the currently configured steward for any portfolio (defaults to owner).
- For a full explanation of what happens when a wallet is not reconnected, see [DISCONNECTED_WALLET_BEHAVIOR.md](DISCONNECTED_WALLET_BEHAVIOR.md).

### Emergency stop
A contract-level safety flag toggled by `set_emergency_stop`.
- When active, deposit and rebalance calls are blocked.
- Only the admin address stored during initialization may change this flag.

### Cooldown period
A time guard that prevents rebalancing too frequently.
- The contract enforces a minimum delay (`REBALANCE_COOLDOWN_SECONDS`, currently 3600 seconds / 1 hour) between successful rebalances.
- If a rebalance attempt happens too soon, it returns `Error::CooldownActive`.

### Contract ABI
The contract ABI describes the exposed smart contract functions, parameter types, and error codes.
- `contracts/CONTRACT_ABI.md` is the canonical reference for the Rust contract interface.
- Use this document together with `docs/GLOSSARY.md` to understand the terms used by contract functions.

### OpenAPI / API contract
The backend exposes a versioned REST API under `/api/v1/*`.
- `API.md` explains how to use the endpoints.
- `backend/docs/openapi.md` explains how the OpenAPI spec is generated and maintained.

### Wallet integration
The frontend integrates with Stellar wallets such as Freighter and Rabet.
- Wallets are used to authorize portfolio actions and sign transactions.
- The UI uses the wallet session to call backend endpoints and contract interactions.

### Threshold strategy (default)
The default rebalancing strategy. Triggers a rebalance **only when any asset's allocation drift exceeds the portfolio's `rebalance_threshold` percent**. It has no time-based or volatility-based conditions. Used when `strategy: threshold` (or no strategy is specified — it is the default).

### DCA (Dollar-Cost Averaging)
A strategy that invests a fixed amount of funds at regular intervals, regardless of asset prices. In this project, the backend exposes it as a dedicated strategy type (`strategy: dca`) used for automated scheduled purchases. Configure with `dcaAmount` (USDC amount per interval) and `dcaIntervalDays` in `strategyConfig`.

- **Note on layering:** DCA is *not* a `StrategyType` variant in the on-chain contract. The contract implements DCA via the separate `configure_dca` and `execute_dca` entrypoints with a dedicated on-chain storage struct. See [DCAConfig](#dcaconfig-dollar-cost-averaging-on-chain-config) below.
- The backend's `dca` strategy type is a virtual wrapper that maps onto those contract calls so the scheduler can trigger DCA buys on the configured cadence.
- See [Rebalancing Strategies](REBALANCING_STRATEGIES.md) for configuration details.
- Backend implementation: `backend/src/services/rebalancingStrategyService.ts`.

### Periodic strategy
A time-based rebalancing strategy that triggers on a **fixed schedule** (e.g. every 7 or 30 days), regardless of allocation drift. Configure with `intervalDays` in `strategyConfig` when creating a portfolio with `strategy: periodic`.

- Contract layer stores interval as `strategy_config.interval_seconds` (default: 604 800 seconds / 7 days).
- See [Rebalancing Strategies](REBALANCING_STRATEGIES.md) for configuration details.
- Backend implementation: `backend/src/services/rebalancingStrategyService.ts`.

### Volatility strategy
A rebalancing strategy that triggers when **market volatility exceeds a configured threshold** (e.g. 24h price change >= 10%) or when allocation drift exceeds the portfolio's rebalance threshold. Configure with `volatilityThresholdPct` in `strategyConfig` when creating a portfolio with `strategy: volatility`.

- Combines volatility-based and drift-based triggers for more responsive rebalancing.
- Contract layer stores threshold as `strategy_config.volatility_threshold_bps` (default: 1 000 bps / 10%).
- See [Rebalancing Strategies](REBALANCING_STRATEGIES.md) for configuration details.
- Backend implementation: `backend/src/services/rebalancingStrategyService.ts`.

### Custom strategy
A user-defined rebalancing rule that enforces a **minimum number of days between rebalances** and only triggers when the drift-based threshold check would also fire. Configure with `minDaysBetweenRebalance` in `strategyConfig` when creating a portfolio with `strategy: custom`.

- Use case: reduce trading frequency while still reacting to drift.
- Contract layer stores minimum interval in `strategy_config.min_interval_seconds` (default: 86 400 seconds / 1 day).
- See [Rebalancing Strategies](REBALANCING_STRATEGIES.md) for configuration details.
- Backend implementation: `backend/src/services/rebalancingStrategyService.ts`.

### Stop loss
A per-asset price floor stored via `set_stop_loss(portfolio_id, asset, price)`. When the Reflector oracle reports an asset price at or below the configured floor during `execute_rebalance`, the stop loss **fires**: the asset's target allocation is set to 0 (proportional to remaining assets).

- Managed by `set_stop_loss`, `remove_stop_loss`, `get_stop_loss` contract entrypoints.
- Uses the same steward/owner authorization rules as rebalance calls.
- Emits `("stop_loss","triggered") events when a stop loss adjusts an allocation.
- Not a StrategyType variant — it is a parallel safety overlay that runs during rebalance execution, independent of which strategy is active.

### Template
A named on-chain allocation template (name → `Map<Address, u32>` in bps) created by the contract admin via `create_template`. End users create new portfolios from a template by passing `template_name` to `create_portfolio_with_template`, so the template's allocations are loaded rather than supplying a raw allocation map directly.

- Bounded by `MAX_TEMPLATES` (50). List all names with `list_templates`, retrieve a template by name with `get_template`.
- Useful for standard portfolio strategies (e.g. "60/40", "Risk Parity") so users do not need to re-enter common allocations.

### DCAConfig (Dollar-Cost Averaging on-chain config)
The on-chain storage struct backing the DCA strategy entrypoints. Stored separately from the Portfolio struct at `DataKey::DCAConfig(portfolio_id)`.

- Fields: `enabled` (bool), `amount` (fixed USDC-denominated amount in the asset's smallest units per interval), `interval` (seconds between executions), `next_execution` (ledger timestamp of the next scheduled run).
- Manipulated by `configure_dca` and `execute_dca` contract entrypoints, NOT via `strategy_config` on the Portfolio struct.
- The backend's `strategy: dca` type is a virtual wrapper that maps onto these contract calls so the scheduler can trigger DCA buys on the configured cadence.

## Example workflow

Read this glossary, then follow these steps for a local contributor workflow:

1. Read `README.md` for the project overview and setup links.
2. Open `docs/CONTRIBUTING.md` and complete the local install steps.
3. If you are working on contract behavior, read `contracts/CONTRACT_ABI.md` and use the glossary to understand terms like `rebalance_threshold`, `slippage_tolerance`, and `portfolio_id`.
4. Start backend and frontend servers.
5. Use the API examples in `README.md` or `API.md` to create a portfolio, check its status, and run a rebalance.

### Sample portfolio creation example

```json
POST /api/v1/portfolio
{
  "userAddress": "G...USER_ADDRESS",
  "name": "Balanced Growth",
  "description": "Diversified portfolio with periodic rebalancing",
  "allocations": {"XLM": 40, "USDC": 35, "BTC": 25},
  "threshold": 5,
  "slippageTolerance": 0.5,
  "strategy": "periodic",
  "strategyConfig": {
    "intervalDays": 7
  }
}
```

### Sample contract initialization example

```bash
soroban contract invoke \
  --id YOUR_CONTRACT_ID \
  --source deployer \
  --network testnet \
  -- initialize \
  --admin YOUR_ADMIN_ADDRESS \
  --reflector_address CDSWUUXGPWDZG76ISK6SUCVPZJMD5YUV66J2FXFXFGDX25XKZJIEITAO
```

## Maintenance notes

- Update this glossary whenever a new contract function, API field, or UI term is introduced.
- If `contracts/CONTRACT_ABI.md` or `API.md` changes, add or revise glossary definitions to keep the docs aligned.
- Keep the examples in this file in sync with the actual API request/response shapes and contract initialization commands.
- If a term moves from backend-only to shared UI/contract usage, make sure the glossary definition reflects both sides.
- Update the **Last verified** block whenever you audit or correct the glossary.

## Last verified

- **Date:** 2026-09-29
- **Commit:** `717ea953f3a338c35bfdbc73e06eddb95f216273`
- **Verified against:** contract types in `contracts/src/types.rs` and `contracts/src/lib.rs`, backend schemas in `backend/src/api/validation.ts`, backend types in `backend/src/types/index.ts`

## Deep references

- [Contributor guide](CONTRIBUTING.md)
- [Contract ABI reference](../contracts/CONTRACT_ABI.md)
- [Soroban Cookbook](soroban-cookbook.md)
- [Contract deployment checklist](CONTRACT_DEPLOYMENT_CHECKLIST.md)
- [API reference](../API.md)
- [Rebalancing Strategies](REBALANCING_STRATEGIES.md)
- [Disconnected Wallet Behavior](DISCONNECTED_WALLET_BEHAVIOR.md)
