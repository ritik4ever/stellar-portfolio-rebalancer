# Contract Deployment Checklist

This guide provides step-by-step checklists for deploying the Stellar Portfolio Rebalancer contract to different environments. Use this to avoid mistakes and ensure consistent deployments.

## Quick Reference

| Environment    | Network    | RPC                                 | Funding   | Risk | Checklist                            |
| -------------- | ---------- | ----------------------------------- | --------- | ---- | ------------------------------------ |
| **Local**      | Standalone | http://localhost:8000               | Unlimited | None | [Local](#local-deployment)           |
| **Testnet**    | Test SDF   | https://soroban-testnet.stellar.org | Friendbot | Low  | [Testnet](#testnet-deployment)       |
| **Staging**    | Testnet    | https://soroban-testnet.stellar.org | Friendbot | Low  | [Staging](#staging-deployment)       |
| **Production** | Mainnet    | https://soroban-mainnet.stellar.org | Real XLM  | High | [Production](#production-deployment) |

---

## Prerequisites (All Environments)

- [ ] Rust toolchain installed: `rustup default stable`
- [ ] WASM target added: `rustup target add wasm32-unknown-unknown`
- [ ] Soroban CLI installed: `cargo install --locked soroban-cli`
- [ ] Contract source code reviewed and tested
- [ ] All tests passing: `cd contracts && cargo test`
- [ ] Contract builds without warnings: `cargo build --target wasm32-unknown-unknown --release`

---

## Local Deployment

Use this for development and testing on a local Soroban instance.

### Setup (One-time)

- [ ] Start local Soroban network:
  ```bash
  soroban network start local
  ```
- [ ] Create local deployer identity:
  ```bash
  soroban keys generate deployer
  ```
- [ ] Verify identity created:
  ```bash
  soroban keys address deployer
  # Output: G...
  ```

### Build

- [ ] Build contract:
  ```bash
  cd contracts
  make build
  ```
- [ ] Verify WASM artifact exists:
  ```bash
  ls -lh target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm
  ```

### Deploy

- [ ] Deploy to local network:
  ```bash
  soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm \
    --source deployer \
    --network local
  ```
- [ ] Save contract ID (output from deploy):
  ```bash
  export CONTRACT_ID=C...
  echo "Contract deployed: $CONTRACT_ID"
  ```

### Initialize

- [ ] Get deployer address:
  ```bash
  export ADMIN_ADDRESS=$(soroban keys address deployer)
  ```
- [ ] Deploy Reflector contract (or use existing):
  ```bash
  export REFLECTOR_ADDRESS=C...
  ```
- [ ] Initialize contract:
  ```bash
  soroban contract invoke \
    --id $CONTRACT_ID \
    --source deployer \
    --network local \
    -- initialize \
    --admin $ADMIN_ADDRESS \
    --reflector_address $REFLECTOR_ADDRESS
  ```
- [ ] Verify initialization:
  ```bash
  soroban contract invoke \
    --id $CONTRACT_ID \
    --source deployer \
    --network local \
    -- get_portfolio \
    --portfolio_id 1
  ```

### Backend Configuration

- [ ] Update `backend/.env`:
  ```env
  STELLAR_NETWORK=local
  STELLAR_CONTRACT_ADDRESS=$CONTRACT_ID
  STELLAR_REBALANCE_SECRET=S...
  SOROBAN_RPC_URL=http://localhost:8000
  ```
- [ ] Restart backend:
  ```bash
  npm run dev
  ```
- [ ] Verify contract indexer connected:
  ```bash
  curl http://localhost:3001/api/v1/indexer/cursor
  ```

### Testing

- [ ] Run contract tests:
  ```bash
  cd contracts && cargo test
  ```
- [ ] Test portfolio creation via API:
  ```bash
  curl -X POST http://localhost:3001/api/portfolio \
    -H "Content-Type: application/json" \
    -d '{
      "userAddress": "G...",
      "allocations": {"XLM": 50, "USDC": 50},
      "threshold": 5
    }'
  ```
- [ ] Verify portfolio created on-chain:
  ```bash
  soroban contract invoke \
    --id $CONTRACT_ID \
    --source deployer \
    --network local \
    -- get_portfolio \
    --portfolio_id 1
  ```

---

## Testnet Deployment

Use this for testing with real Stellar testnet infrastructure.

### Prerequisites

- [ ] Testnet deployer identity created:
  ```bash
  soroban keys generate deployer
  ```
- [ ] Deployer funded via Friendbot:
  ```bash
  DEPLOYER_ADDRESS=$(soroban keys address deployer)
  # Visit: https://laboratory.stellar.org/#account-creator?network=test
  # Or use: curl "https://friendbot.stellar.org?addr=$DEPLOYER_ADDRESS"
  ```
- [ ] Verify funding:
  ```bash
  soroban keys address deployer
  # Check balance at: https://stellar.expert/explorer/testnet/account/$DEPLOYER_ADDRESS
  ```

### Setup (One-time)

- [ ] Add testnet network profile:
  ```bash
  soroban network add testnet \
    --rpc-url https://soroban-testnet.stellar.org \
    --network-passphrase "Test SDF Network ; September 2015"
  ```
- [ ] Verify network added:
  ```bash
  soroban network ls
  # Should show: testnet
  ```

### Build

- [ ] Build contract:
  ```bash
  cd contracts
  make build
  ```
- [ ] Optimize for testnet (optional but recommended):
  ```bash
  make build-optimized
  ```
- [ ] Verify WASM size:
  ```bash
  ls -lh target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm
  # Should be < 256 KB
  ```

### Deploy

- [ ] Deploy to testnet:
  ```bash
  soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm \
    --source deployer \
    --network testnet
  ```
- [ ] Save contract ID:
  ```bash
  export CONTRACT_ID=C...
  echo "Testnet contract: $CONTRACT_ID"
  ```
- [ ] Verify deployment:
  ```bash
  soroban contract info \
    --id $CONTRACT_ID \
    --network testnet
  ```

### Initialize

- [ ] Get deployer address:
  ```bash
  export ADMIN_ADDRESS=$(soroban keys address deployer)
  ```
- [ ] Get Reflector contract address (ask team or deploy):
  ```bash
  export REFLECTOR_ADDRESS=C...
  ```
- [ ] Initialize contract:
  ```bash
  soroban contract invoke \
    --id $CONTRACT_ID \
    --source deployer \
    --network testnet \
    -- initialize \
    --admin $ADMIN_ADDRESS \
    --reflector_address $REFLECTOR_ADDRESS
  ```
- [ ] Verify initialization:
  ```bash
  soroban contract invoke \
    --id $CONTRACT_ID \
    --source deployer \
    --network testnet \
    -- get_portfolio \
    --portfolio_id 1
  ```

### Backend Configuration

- [ ] Update `backend/.env`:
  ```env
  STELLAR_NETWORK=testnet
  STELLAR_CONTRACT_ADDRESS=$CONTRACT_ID
  STELLAR_REBALANCE_SECRET=S...
  SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
  ```
- [ ] Restart backend:
  ```bash
  npm run dev
  ```
- [ ] Verify contract indexer connected:
  ```bash
  curl http://localhost:3001/api/v1/indexer/cursor
  ```

### Testing

- [ ] Test portfolio creation:
  ```bash
  curl -X POST http://localhost:3001/api/portfolio \
    -H "Content-Type: application/json" \
    -d '{
      "userAddress": "G...",
      "allocations": {"XLM": 50, "USDC": 50},
      "threshold": 5
    }'
  ```
- [ ] Verify on-chain:
  ```bash
  soroban contract invoke \
    --id $CONTRACT_ID \
    --source deployer \
    --network testnet \
    -- get_portfolio \
    --portfolio_id 1
  ```
- [ ] Check contract events:
  ```bash
  curl "https://soroban-testnet.stellar.org/events?contract_id=$CONTRACT_ID"
  ```

### Documentation

- [ ] Document contract address in team wiki/Slack
- [ ] Update deployment notes with timestamp and deployer
- [ ] Record Reflector contract address used

---

## Staging Deployment

Use this for pre-production testing on testnet.

### Prerequisites

- [ ] Staging deployer identity created (separate from dev):
  ```bash
  soroban keys generate staging-deployer
  ```
- [ ] Staging deployer funded:
  ```bash
  STAGING_DEPLOYER=$(soroban keys address staging-deployer)
  curl "https://friendbot.stellar.org?addr=$STAGING_DEPLOYER"
  ```

### Build

- [ ] Build and optimize:
  ```bash
  cd contracts
  make build-optimized
  ```
- [ ] Run full test suite:
  ```bash
  cargo test
  ```
- [ ] Run gas benchmarks:
  ```bash
  cargo test benchmark_
  ```

### Deploy

- [ ] Deploy with staging deployer:
  ```bash
  soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm \
    --source staging-deployer \
    --network testnet
  ```
- [ ] Save staging contract ID:
  ```bash
  export STAGING_CONTRACT_ID=C...
  ```

### Initialize

- [ ] Initialize with staging admin:

  ```bash
  export STAGING_ADMIN=$(soroban keys address staging-deployer)
  export STAGING_REFLECTOR=C...

  soroban contract invoke \
    --id $STAGING_CONTRACT_ID \
    --source staging-deployer \
    --network testnet \
    -- initialize \
    --admin $STAGING_ADMIN \
    --reflector_address $STAGING_REFLECTOR
  ```

### Staging Environment Configuration

- [ ] Update staging backend `.env`:
  ```env
  STELLAR_NETWORK=testnet
  STELLAR_CONTRACT_ADDRESS=$STAGING_CONTRACT_ID
  STELLAR_REBALANCE_SECRET=S...
  SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
  ENABLE_AUTO_REBALANCER=true
  ```
- [ ] Deploy staging backend
- [ ] Run staging E2E tests:
  ```bash
  npm run test:e2e:staging
  ```

### Validation

- [ ] Verify all E2E tests pass
- [ ] Verify auto-rebalancer works
- [ ] Verify notifications send
- [ ] Verify analytics snapshots capture
- [ ] Load test with concurrent users
- [ ] Test error scenarios (insufficient balance, slippage, etc.)

### Sign-off

- [ ] QA team approves staging deployment
- [ ] Product team reviews contract behavior
- [ ] Security team reviews contract code (if applicable)

---

## Production Deployment

Use this for mainnet deployment. **This is irreversible and uses real XLM.**

### Prerequisites

- [ ] Production deployer identity created (hardware wallet recommended):
  ```bash
  soroban keys generate prod-deployer
  ```
- [ ] Production deployer funded with sufficient XLM:
  ```bash
  PROD_DEPLOYER=$(soroban keys address prod-deployer)
  # Fund via exchange or existing account
  # Verify balance: https://stellar.expert/explorer/public/account/$PROD_DEPLOYER
  ```
- [ ] Mainnet network profile added:
  ```bash
  soroban network add mainnet \
    --rpc-url https://soroban-mainnet.stellar.org \
    --network-passphrase "Public Global Stellar Network ; September 2015"
  ```

### Code Review

- [ ] Contract code reviewed by 2+ team members
- [ ] All tests passing on staging
- [ ] No security vulnerabilities identified
- [ ] Gas costs acceptable
- [ ] Contract ABI documented

### Build

- [ ] Build and optimize:
  ```bash
  cd contracts
  make build-optimized
  ```
- [ ] Verify WASM size:
  ```bash
  ls -lh target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm
  ```
- [ ] Generate deployment report:
  ```bash
  soroban contract info \
    --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm
  ```

### Pre-Deployment Checklist

- [ ] Backup production deployer private key (secure location)
- [ ] Verify production RPC endpoint is responsive:
  ```bash
  curl https://soroban-mainnet.stellar.org/health
  ```
- [ ] Verify Reflector contract address on mainnet:
  ```bash
  export PROD_REFLECTOR=C...
  soroban contract info --id $PROD_REFLECTOR --network mainnet
  ```
- [ ] Notify team of deployment window
- [ ] Prepare rollback plan (if needed)

### Deploy

- [ ] **FINAL CONFIRMATION:** This will use real XLM and cannot be undone
  ```bash
  soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm \
    --source prod-deployer \
    --network mainnet
  ```
- [ ] Save production contract ID:
  ```bash
  export PROD_CONTRACT_ID=C...
  echo "Production contract: $PROD_CONTRACT_ID"
  ```
- [ ] Verify deployment on mainnet:
  ```bash
  soroban contract info \
    --id $PROD_CONTRACT_ID \
    --network mainnet
  ```

### Initialize

- [ ] Get production admin address:
  ```bash
  export PROD_ADMIN=$(soroban keys address prod-deployer)
  ```
- [ ] Initialize contract:
  ```bash
  soroban contract invoke \
    --id $PROD_CONTRACT_ID \
    --source prod-deployer \
    --network mainnet \
    -- initialize \
    --admin $PROD_ADMIN \
    --reflector_address $PROD_REFLECTOR
  ```
- [ ] Verify initialization:
  ```bash
  soroban contract invoke \
    --id $PROD_CONTRACT_ID \
    --source prod-deployer \
    --network mainnet \
    -- get_portfolio \
    --portfolio_id 1
  ```

### Production Environment Configuration

- [ ] Update production backend `.env`:
  ```env
  STELLAR_NETWORK=mainnet
  STELLAR_CONTRACT_ADDRESS=$PROD_CONTRACT_ID
  STELLAR_REBALANCE_SECRET=S...
  SOROBAN_RPC_URL=https://soroban-mainnet.stellar.org
  ENABLE_AUTO_REBALANCER=true
  ```
- [ ] Deploy production backend
- [ ] Verify contract indexer connected:
  ```bash
  curl https://api.stellarportfolio.com/api/v1/indexer/cursor
  ```

### Post-Deployment Validation

- [ ] Monitor contract events for 24 hours
- [ ] Verify auto-rebalancer executes correctly
- [ ] Verify notifications send
- [ ] Monitor error rates and latency
- [ ] Check blockchain explorer for contract activity:
  ```
  https://stellar.expert/explorer/public/contract/$PROD_CONTRACT_ID
  ```

### Documentation

- [ ] Document production contract address
- [ ] Update deployment log with timestamp, deployer, and notes
- [ ] Create incident response runbook
- [ ] Notify stakeholders of successful deployment
- [ ] Archive deployment artifacts (WASM, ABI, etc.)

---

## Rollback Procedure

If production deployment fails or needs to be reverted:

### Immediate Actions

- [ ] Stop auto-rebalancer:
  ```bash
  curl -X POST https://api.stellarportfolio.com/api/v1/admin/auto-rebalancer/stop \
    -H "X-Admin-Key: ..."
  ```
- [ ] Revert backend `.env` to previous contract address
- [ ] Restart backend
- [ ] Verify old contract is active

### Investigation

- [ ] Review contract events for errors
- [ ] Check backend logs for indexer errors
- [ ] Analyze failed transactions on blockchain
- [ ] Document root cause

### Communication

- [ ] Notify users of issue and rollback
- [ ] Provide ETA for fix
- [ ] Update status page

---

## Environment Variables Reference

### Local

```env
STELLAR_NETWORK=local
STELLAR_CONTRACT_ADDRESS=C...
STELLAR_REBALANCE_SECRET=S...
SOROBAN_RPC_URL=http://localhost:8000
```

### Testnet

```env
STELLAR_NETWORK=testnet
STELLAR_CONTRACT_ADDRESS=C...
STELLAR_REBALANCE_SECRET=S...
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

### Staging

```env
STELLAR_NETWORK=testnet
STELLAR_CONTRACT_ADDRESS=C...
STELLAR_REBALANCE_SECRET=S...
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
ENABLE_AUTO_REBALANCER=true
```

### Production

```env
STELLAR_NETWORK=mainnet
STELLAR_CONTRACT_ADDRESS=C...
STELLAR_REBALANCE_SECRET=S...
SOROBAN_RPC_URL=https://soroban-mainnet.stellar.org
ENABLE_AUTO_REBALANCER=true
```

---

## Related Documentation

- [Makefile targets](../contracts/Makefile) — build, test, deploy commands
- [Contract ABI](../contracts/CONTRACT_ABI.md) — contract interface reference
- [Operations handbook](../docs/OPERATIONS.md) — backend operations
- [Environment variables](../docs/ENVIRONMENT.md) — full reference

---

## Maintenance Notes

- **Test deployments regularly** — practice on testnet before production
- **Keep deployer keys secure** — use hardware wallets for production
- **Document each deployment** — timestamp, deployer, contract ID, notes
- **Monitor contract events** — watch for unexpected behavior post-deployment
- **Plan upgrades** — contract upgrades require new deployment (no in-place updates)
