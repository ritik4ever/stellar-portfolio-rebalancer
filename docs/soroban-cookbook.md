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

Use `update_allocations` to replace a portfolio's target percentages without
moving funds immediately. The contract entrypoint is
`update_allocations(portfolio_id: u64, new_allocations: Map<Address, u32>)` in
[`contracts/src/lib.rs`](../contracts/src/lib.rs#L743-L778). Each value is in
basis points of the allocation denominator: the values must be positive and
sum to **10,000** (for example, 7,000 and 3,000 represent 70% and 30%). The
new map may contain only assets already registered on the portfolio.

Before submitting a write, check that the deployment exposes
`update_allocations` in the capability matrix. Deployments that do not expose
the method must remain read-only for allocations; see the
[`CONTRACT_CAPABILITY_MATRIX.md`](CONTRACT_CAPABILITY_MATRIX.md#capability-matrix)
entry for the required fallback.

#### CLI

The Soroban CLI accepts the `Map<Address, u32>` argument as a JSON object. The
`--source` identity must be able to authorize the portfolio owner address.
Replace the placeholders with real Stellar addresses and a portfolio ID:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source <OWNER_SECRET_KEY_OR_IDENTITY> \
  --network testnet \
  -- update_allocations \
  --portfolio_id 1 \
  --new_allocations '{"<ASSET_A_ADDRESS>": 7000, "<ASSET_B_ADDRESS>": 3000}'
```

For a dry run, add `--simulate` before `--` to catch authorization and
validation failures without submitting the transaction. A successful
transaction returns the contract's `()` result; inspect the transaction's
contract events to verify the allocation update.

#### SDK (TypeScript)

The explicit `xdr.ScVal.scvMap` construction below preserves the fact that
both map keys are Stellar `Address` values and both map values are `u32`
values. Add the returned operation to the transaction builder used by the
application, then simulate, assemble, sign with the owner key, and submit it
through the normal Soroban RPC flow.

```typescript
import {
  Address,
  Contract,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";

const contract = new Contract("<CONTRACT_ID>");
const portfolioId = nativeToScVal(1, { type: "u64" });
const allocations = xdr.ScVal.scvMap([
  new xdr.ScMapEntry(
    Address.fromString("<ASSET_A_ADDRESS>").toScVal(),
    nativeToScVal(7000, { type: "u32" }),
  ),
  new xdr.ScMapEntry(
    Address.fromString("<ASSET_B_ADDRESS>").toScVal(),
    nativeToScVal(3000, { type: "u32" }),
  ),
]);

const operation = contract.call("update_allocations", portfolioId, allocations);

// Add `operation` to a TransactionBuilder, simulate/assemble it, sign with
// the portfolio owner key, and submit through SorobanRpc.Server. For example:
// const tx = new TransactionBuilder(account, feeAndNetworkOptions)
//   .addOperation(operation).setTimeout(300).build();
// const simulated = await server.simulateTransaction(tx);
// const prepared = SorobanRpc.assembleTransaction(tx, simulated).build();
// prepared.sign(ownerKeypair);
// await server.sendTransaction(prepared);
```

The contract argument name is `new_allocations`, even though the capability
matrix calls the logical field `target_allocations`. The SDK operation must use
the entrypoint name and positional argument order shown above.

#### Required Auth

The current entrypoint requires the **portfolio owner** (`portfolio.user`) to
authorize the call with `require_auth()`. The transaction therefore fails if
it is signed only by an unrelated account. The repository's stewardship model
also exposes a **current steward**, and the capability documentation may refer
to owner/steward authorization for deployments that delegate write authority;
however, this implementation does not resolve `DataKey::Steward(portfolio_id)`
inside `update_allocations`. Until that contract behavior changes, sign with
the owner key. If a future deployment explicitly accepts the steward, sign with
the current steward key and verify the deployed contract version first.

#### Expected Event Emission

A successful call emits one contract event with topics
`("portfolio", "alloc_upd")` and data `(portfolio_id, old_allocations,
new_allocations)`. The old and new maps are included in the event, which lets
indexers reconstruct the change without reading the portfolio again. See the
[`CONTRACT_EVENTS.md`](CONTRACT_EVENTS.md#alloc_upd-event-details) event
reference and the `test_update_allocations_success` fixture for the canonical
shape.

#### Common Error Scenarios

| Error | Meaning | Guidance |
| --- | --- | --- |
| `Error(Auth)` or an authorization failure | The owner (or a deployment-supported steward) did not authorize the invocation. | Sign the transaction with the required address and ensure the identity passed to `--source` controls that key. |
| `InvalidAllocation` | Values are non-positive or do not sum to 10,000. | Recalculate the map in basis points; for two assets, `7000 + 3000` is valid. |
| `AssetNotSupported` | A map key is not already present in the portfolio's supported asset set. | Use only assets returned by `get_portfolio`; create a new portfolio if the asset set must change. |
| `PortfolioNotFound` | The supplied portfolio ID is not stored by the contract. | Call `get_portfolio` with the ID and check the deployed contract address/network. |
| `TooManyAssets` or `PortfolioStorageFootprintTooLarge` | The updated portfolio exceeds its asset-count or storage limits. | Keep the allocation map within `MAX_PORTFOLIO_ASSETS` and avoid introducing additional asset keys. |
| `PortfolioPaused` or `EmergencyStop` | The portfolio or contract is paused. | Inspect the portfolio pause state and wait for the administrator or authorized actor to clear the stop before retrying. |
| Capability unavailable | The deployment does not advertise this write method. | Do not invoke optimistically; keep the UI read-only and use the fallback described in the capability matrix. |

#### Test Coverage

`update_allocations` is a write capability in
[`frontend/src/lib/contractCapabilities.ts`](../frontend/src/lib/contractCapabilities.ts)
and the human-readable matrix. Check `availableMethods` and `writesEnabled`
before constructing the transaction. The contract's `capabilities()` and
`capability_summary()` endpoints are the version/capability discovery points;
use them to avoid sending this recipe to an older deployment. The matrix
records the method as emitting `alloc_upd` and specifies the safe fallback:
**block the write and keep existing allocations visible read-only**.

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