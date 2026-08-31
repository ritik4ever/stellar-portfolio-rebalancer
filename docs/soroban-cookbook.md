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

**Signature** (`contracts/src/lib.rs`):

```text
update_allocations(portfolio_id: u64, new_allocations: Map<Address, u32>) -> Result<(), Error>
```

#### CLI

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- update_allocations \
  --portfolio_id 1 \
  --new_allocations '{"CDML...": 60, "CDEF...": 40}'
```

#### SDK (TypeScript)

```typescript
import { Contract, nativeToScVal } from "@stellar/stellar-sdk";

// Replace with your deployed contract ID and desired values.
const CONTRACT_ID = "C...";           // deployed portfolio_rebalancer contract ID
const portfolioId = 1;                // u64 portfolio ID
const newAllocations: Record<string, number> = {
  "CDML...": 6000,                    // 60% in basis points
  "CDEF...": 4000,                    // 40% in basis points
}; // Map<Address, u32>, values must sum to 10000

const contract = new Contract(CONTRACT_ID);
const op = contract.call(
  "update_allocations",
  nativeToScVal(portfolioId, { type: "u64" }),
  nativeToScVal(newAllocations, { type: "map" })
);
// Build, sign with the portfolio owner key, and submit as usual.
```

#### Required Auth

The portfolio **owner** (`portfolio.user`) must authorize the call. This is
enforced via `portfolio.user.require_auth()` in `update_allocations`. If
stewardship has been transferred, the steward does **not** have permission to
update allocations — only the original owner does.

#### Event Emission

Emits a `portfolio.alloc_upd` event with the portfolio ID, old allocations,
and new allocations:

```
topic: (symbol_short!("portfolio"), Symbol::new(&env, "alloc_upd"))
data:  (portfolio_id, old_allocations, new_allocations)
```

#### Common Error Scenarios

| Error | Code | Trigger | Guidance |
| --- | --- | --- | --- |
| `InvalidAllocation` | 1 | New `target_allocations` don't sum to exactly 10,000 bps, or an asset has a 0% allocation | `validate_allocations` requires percentages to sum to `ALLOCATION_DENOMINATOR` (10,000) and rejects any zero entries — recheck your allocation map |
| `AssetNotSupported` | 25 | An asset in `new_allocations` is not in the portfolio's `asset_decimals` map | Only assets that were registered at portfolio creation can be targeted — remove unknown assets or recreate the portfolio |
| `InvariantViolation` | 14 | Post-update invariant check failed (e.g. allocations no longer valid after mutation) | Ensure the new allocations map passes `validate_allocations` |
| `PortfolioNotFound` | 21 | `portfolio_id` doesn't exist in storage | Verify the ID with `get_portfolio` first |

#### Test Coverage

- `test_update_allocations_success` — verifies allocations are persisted after update
- `test_update_allocations_invalid_sum` — rejects allocations not summing to 10,000
- `test_update_allocations_unknown_asset` — rejects assets not in the portfolio's `asset_decimals`
- `test_update_allocations_then_rebalance` — update allocations then execute a rebalance using the new targets

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