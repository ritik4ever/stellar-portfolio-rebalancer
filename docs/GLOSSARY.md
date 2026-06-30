# Glossary

This glossary defines the main terms used across the Stellar Portfolio Rebalancer repository, including frontend concepts, backend API patterns, and Soroban smart contract terminology.

## How to use this glossary

- New contributors should read this before working on contracts, backend features, or documentation.
- If you see a term in `README.md`, `docs/CONTRIBUTING.md`, or `contracts/CONTRACT_ABI.md`, this page explains it in plain language.
- Use the cross-links to jump to deeper references for contract invocation, API docs, and deployment guides.

## Key terms

### Portfolio
A **Portfolio** is the main user-owned object in the system. It stores:
- `target_allocations`: how the user wants funds split across assets
- `current_balances`: the actual balances currently held
- `rebalance_threshold`: the drift limit that triggers a rebalance
- `slippage_tolerance`: how much execution slippage is allowed

In the smart contract, a portfolio is identified by a numeric `portfolio_id` returned by `create_portfolio`.

### Target allocation
`target_allocations` is a mapping of asset addresses to target percentages.
- Example: `{ "XLM": 40, "USDC": 35, "BTC": 25 }`
- The values are percentages and should sum to 100.
- The contract checks this during `create_portfolio` and rejects invalid allocations with `InvalidAllocation`.

### Rebalance threshold / drift threshold
Also called **threshold** in the UI and contract.
- A value between `1` and `50`.
- The contract uses this value to decide whether current asset weights have drifted far enough from targets to require a rebalance.
- The backend and frontend refer to this as `rebalance_threshold`.

### Slippage tolerance
A tolerance value expressed in basis points (`10..=500`) used by the contract to validate actual post-trade balances.
- Example: `50` means `0.50%` slippage is allowed.
- If executed balances fall outside this tolerance, `execute_rebalance` returns `SlippageExceeded`.

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

### Emergency stop
A contract-level safety flag toggled by `set_emergency_stop`.
- When active, deposit and rebalance calls are blocked.
- Only the admin address stored during initialization may change this flag.

### Cooldown period
A time guard that prevents rebalancing too frequently.
- The contract enforces a minimum delay between successful rebalances.
- If a rebalance attempt happens too soon, it fails with a cooldown-related panic.

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
  "allocations": {"XLM": 40, "USDC": 35, "BTC": 25},
  "threshold": 5,
  "slippageTolerance": 50
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

## Deep references

- [Contributor guide](docs/CONTRIBUTING.md)
- [Contract ABI reference](../contracts/CONTRACT_ABI.md)
- [Soroban Cookbook](docs/soroban-cookbook.md)
- [Contract deployment checklist](docs/CONTRACT_DEPLOYMENT_CHECKLIST.md)
- [API reference](API.md)
