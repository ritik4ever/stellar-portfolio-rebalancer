# Soroban Development Cookbook

This guide provides a practical reference for common Soroban CLI commands used when developing and interacting with the Stellar Portfolio Rebalancer contracts.

## Local Testnet Workflows

### 1. Start a Local Network
If you are not using the public testnet, you can start a local sandbox:
```bash
soroban network start local
```

### 2. Generate and Fund Identities
```bash
soroban keys generate deployer
soroban keys generate alice
soroban keys generate bob

# If on public testnet, fund via friendbot.
# For local network:
soroban keys fund deployer --network local
soroban keys fund alice --network local
```

## Contract Build & Deploy Commands

### 1. Build the Contract
```bash
make build
# or manually:
cargo build --target wasm32-unknown-unknown --release
```

### 2. Deploy the Contract
```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm \
  --source deployer \
  --network testnet
```
*Take note of the resulting Contract ID.*

### 3. Initialize the Contract
```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source deployer \
  --network testnet \
  -- initialize \
  --admin <ADMIN_ADDRESS> \
  --reflector_address <REFLECTOR_ADDRESS>
```

## Invoke Examples

### 1. Create a Portfolio
```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- create_portfolio \
  --user $(soroban keys address alice) \
  --target_allocations '{"CDML...": 50, "CDEF...": 50}' \
  --rebalance_threshold 5 \
  --slippage_tolerance 100
```

### 2. Deposit Funds
```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- deposit \
  --portfolio_id 1 \
  --asset <ASSET_ADDRESS> \
  --amount 100000000
```

### 3. Check if Rebalance Needed
```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- check_rebalance_needed \
  --portfolio_id 1
```

### 4. Execute Rebalance
```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- execute_rebalance \
  --portfolio_id 1 \
  --actual_balances '{"CDML...": 150000000, "CDEF...": 50000000}'
```

### 5. Update Portfolio Allocations

> **Status: proposed, not yet implemented.** As of the current `main` branch,
> `update_allocations` does not exist as a contract entrypoint in
> `contracts/src/lib.rs`. It is defined only at the planning layer:
> `docs/CONTRACT_CAPABILITY_MATRIX.md` and
> `frontend/src/lib/contractCapabilities.ts` describe the intended
> signature below, gated behind capability detection so the frontend can
> fall back gracefully on deployments that don't support it yet. Treat the
> examples in this section as **anticipated usage**, not a verified
> working recipe, until the entrypoint lands in `lib.rs`.

**Proposed signature** (from `frontend/src/lib/contractCapabilities.ts`):

```
update_allocations(portfolio_id: u64, target_allocations: Map<Address, u32>) -> Result<(), Error>
```

#### CLI (anticipated)

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- update_allocations \
  --portfolio_id 1 \
  --target_allocations '{"CDML...": 60, "CDEF...": 40}'
```

#### SDK (anticipated, TypeScript)

```typescript
import { Contract, TransactionBuilder } from "@stellar/stellar-sdk";

const contract = new Contract(CONTRACT_ID);
const op = contract.call(
  "update_allocations",
  nativeToScVal(portfolioId, { type: "u64" }),
  nativeToScVal(targetAllocations, { type: "map" }) // Map<Address, u32>
);
// Build, sign with the portfolio owner or steward key, and submit as usual.
```

#### Required Auth

No implementation exists yet to confirm this directly, but every comparable
write entrypoint in `contracts/src/lib.rs` resolves authorization the same
way, so `update_allocations` is expected to follow suit:

- `transfer_stewardship` reads `DataKey::Steward(portfolio_id)`, falls back
  to `portfolio.user` if unset, and calls `.require_auth()` on whichever
  address that resolves to.
- `deposit` follows the identical steward-or-owner lookup pattern.

So invoking `update_allocations` will most likely require a signature from
the **current steward** (or the portfolio **owner**, if no steward has been
explicitly set via `transfer_stewardship`) — not necessarily the original
creator if stewardship has since been transferred. Confirm this once the
entrypoint is implemented, since the exact `require_auth()` target isn't
guaranteed until the code lands.

#### Expected Event Emission

⚠️ The two planning sources disagree on the event name:

- `frontend/src/lib/contractCapabilities.ts` lists the event as `alloc_upd`.
- Every existing on-chain event in `contracts/src/lib.rs` uses the
  `(symbol_short!("portfolio"), Symbol::new(&env, "<action>"))` topic
  pattern instead — e.g. `("portfolio", "created")`,
  `("portfolio", "deposit")`, `("portfolio", "steward_transferred")`.

Given that convention, the actual emitted event is more likely to be
`("portfolio", "allocations_updated")` (or similar) than a bare
`alloc_upd` symbol. **Do not treat `alloc_upd` as confirmed** — verify
against `contracts/src/lib.rs` once implemented and update this section.

#### Common Error Scenarios

These are inferred from the validation helpers in `contracts/src/portfolio.rs`
that `create_portfolio` already calls, since `update_allocations` would need
the same allocation-map validation:

| Error | Code | Likely Trigger | Guidance |
| --- | --- | --- | --- |
| `InvalidAllocation` | 1 | New `target_allocations` don't sum to exactly 100, or an asset has a 0% allocation | `validate_allocations` requires percentages to sum to `ALLOCATION_DENOMINATOR` and rejects any zero entries — recheck your allocation map |
| `TooManyAssets` | 11 | New allocation map exceeds `MAX_PORTFOLIO_ASSETS` (10) | Reduce the number of distinct assets in `target_allocations` |
| `PortfolioStorageFootprintTooLarge` | 22 | Adding new asset keys pushes the serialized `Portfolio` struct over 3072 bytes | Reduce asset count; each asset adds entries across `target_allocations`, `current_balances`, and `asset_decimals` |
| `PortfolioPaused` | 18 | Portfolio is currently paused (user-paused, emergency, or circuit breaker) | Check `pause_reason` via `get_portfolio`; unpause before retrying |
| `EmergencyStop` | 3 | Contract-wide emergency stop is active | Wait for the admin to clear it via `set_emergency_stop` |
| `PortfolioNotFound` | 21 | `portfolio_id` doesn't exist in storage | Verify the ID with `get_portfolio` first |

#### Capability Flag

No bit is currently reserved for this in `CapabilityFlag`
(`contracts/src/types.rs`) — only `PerPortfolioSteward` (`1 << 0`),
`DifferentiatedPricing` (`1 << 1`), and `EmergencyStop` (`1 << 2`) exist
today. `docs/CONTRACT_CAPABILITY_MATRIX.md` and
`frontend/src/lib/contractCapabilities.ts` already describe a fallback
behavior for when this capability is absent ("block the write; keep the
existing allocations visible read-only"), so once implemented, a new flag
bit (e.g. `AllocationUpdate = 1 << 3`) should be added and exposed via
`capabilities()`/`capability_summary()` so frontend clients can detect
support before invoking. See
[`contracts/CONTRACT_ABI.md`](../contracts/CONTRACT_ABI.md#capabilitiesenv-env---u32)
for the existing capability-flag pattern.

## Debugging and Inspection

### 1. Inspect Contract State
Use the `soroban contract read` command to fetch persistent and instance storage data:
```bash
soroban contract read \
  --id <CONTRACT_ID> \
  --network testnet
```

### 2. Fetch Events (Event/Log Inspection)
Filter and stream events emitted by the rebalancer:
```bash
soroban events \
  --start-ledger <LEDGER_NUM> \
  --id <CONTRACT_ID> \
  --network testnet \
  --type contract
```

### 3. Simulation Example
To see the required state changes and auth requirements without submitting the transaction:
```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network testnet \
  --simulate \
  -- execute_rebalance \
  --portfolio_id 1 \
  --actual_balances '{"CDML...": 150000000, "CDEF...": 50000000}'
```

## Maintenance Guidance
Keep these examples aligned with current contract interfaces. If the signature of `create_portfolio` or `execute_rebalance` changes in `contracts/src/lib.rs`, please update this cookbook accordingly.

## Error Reference

For a complete list of contract error codes with numeric values, human-readable descriptions, and suggested recovery actions, see the [Contract ABI Error Codes](../contracts/CONTRACT_ABI.md#error-codes-contractssrctypesrs).