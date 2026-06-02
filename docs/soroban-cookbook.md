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
