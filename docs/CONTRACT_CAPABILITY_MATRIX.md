# Contract Capability Matrix & Frontend Compatibility Guide

This guide lets contributors and integrators understand what the deployed
Soroban contract supports — and how the frontend behaves against unsupported or
outdated deployments — **without reading the contract source first**.

It is the human-readable companion to the machine-readable matrix in
[`frontend/src/lib/contractCapabilities.ts`](../frontend/src/lib/contractCapabilities.ts).
Keep the two in step.

Related docs:

- Event topic/payload shapes and indexer rules: [`CONTRACT_EVENTS.md`](CONTRACT_EVENTS.md)
- Deploying the contract per environment: [`CONTRACT_DEPLOYMENT_CHECKLIST.md`](CONTRACT_DEPLOYMENT_CHECKLIST.md)
- Common `soroban contract invoke` recipes: [`soroban-cookbook.md`](soroban-cookbook.md)

## Schema version

Capability compatibility is tracked by a single integer, the **contract event
schema version**:

| Side     | Constant                                   | Location                                          |
| -------- | ------------------------------------------ | ------------------------------------------------- |
| Backend  | `BACKEND_CONTRACT_EVENT_SCHEMA_VERSION`    | `backend/src/config/contractEventSchema.ts`       |
| Frontend | `FRONTEND_CONTRACT_SCHEMA_VERSION`         | `frontend/src/lib/contractCapabilities.ts`        |

Both are currently `1`. Bump them together when contract topic strings or
payload tuple shapes change, and record the migration for deployers.

## Capability matrix

Aligned with `contracts/src/portfolio.rs`, `contracts/src/events.rs`, and
[`CONTRACT_EVENTS.md`](CONTRACT_EVENTS.md).

| Method                    | Kind  | Expected args                                  | Emits        | Since | Fallback when unavailable                              |
| ------------------------- | ----- | ---------------------------------------------- | ------------ | ----- | ------------------------------------------------------ |
| `get_portfolio`           | read  | `portfolio_id: u64`                            | —            | 1     | Read portfolio state from the backend cache.           |
| `build_rebalance_preview` | read  | `portfolio_id: u64`                            | —            | 1     | Use the backend rebalance-plan endpoint.               |
| `create_portfolio`        | write | `user: Address`, `target_allocations: Map`     | `created`    | 1     | Block the write; do not optimistically create.         |
| `deposit`                 | write | `portfolio_id`, `asset: Address`, `amount`     | `deposit`    | 1     | Block the write; prompt to retry when supported.       |
| `withdraw`                | write | `portfolio_id`, `asset: Address`, `amount`     | `withdraw`   | 1     | Block the write; prompt to retry when supported.       |
| `update_allocations`      | write | `portfolio_id`, `target_allocations: Map`      | `alloc_upd`  | 1     | Block the write; keep allocations read-only.           |
| `rebalance`               | write | `portfolio_id: u64`                            | `rebalanced` | 1     | Disable the action; show preview-only mode.            |

Minimum frontend requirement: a build whose `FRONTEND_CONTRACT_SCHEMA_VERSION`
is **greater than or equal to** the deployment's schema version.

## Startup capability detection

The frontend runs a lightweight detection during startup
(`detectContractCapabilities` in `App.tsx`). Rather than opening a second RPC
connection from the browser, it reuses the backend `/readiness` probe — which
already verifies the contract event schema version — and maps the
`contractEventIndexer` check to a deterministic report:

| Indexer status | Severity  | Writes  | Meaning                                                        |
| -------------- | --------- | ------- | ------------------------------------------------------------- |
| `ready`        | `ok`      | enabled | All documented capabilities available.                        |
| `disabled`     | `warning` | blocked | On-chain features off; reads route through the backend.       |
| `not_ready`    | `error`   | blocked | Outdated/unsupported deployment (e.g. schema mismatch).       |
| probe failed   | `warning` | blocked | Cannot verify; conservative read-only baseline.               |

The report (`ContractCapabilityReport`) carries `writesEnabled`,
`availableMethods`, and a `details` string, and is surfaced in the Developer
Drawer.

## Fallback behaviour (deterministic)

Fallbacks are deterministic and driven entirely by the matrix `fallback` field:

- **Writes** are only attempted when `writesEnabled` is `true` **and** the method
  is in `availableMethods`. Otherwise the matrix `fallback` string is surfaced
  and the write is skipped — never attempted optimistically.
- **Reads** degrade to the backend cache / plan endpoints when the contract is
  not directly reachable.
- When detection cannot run (probe failure), the app defaults to **read-only**.

## Integration example: graceful degradation

Guard every contract write with `capabilityGuardedInvoke`, which consults the
startup report and returns `null` (after surfacing the documented fallback)
instead of failing on-chain:

```ts
import { capabilityGuardedInvoke } from '../lib/soroban'
import {
    detectContractCapabilities,
    isCapabilitySupported,
} from '../lib/contractCapabilities'

const report = await detectContractCapabilities()

// Hide actions the deployment can't honour.
const canRebalance = isCapabilitySupported(report, 'rebalance')

// Writes degrade gracefully when unsupported.
const result = await capabilityGuardedInvoke('deposit', report, () =>
    contract.deposit(portfolioId, asset, amount),
)
if (result === null) {
    // Write was blocked; the fallback message was already shown to the user.
}
```
