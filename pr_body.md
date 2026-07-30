## Description

This PR adds a **complete testnet integration testing infrastructure** for the Stellar Portfolio Rebalancer smart contract, including a **mock reflector oracle contract**, a **real on-chain test suite**, and a **nightly CI workflow**. Fixes #964.

### Motivation

Prior to this PR, the contract test suite was limited to local/mock-based integration tests using `soroban-sdk/testutils`. While these tests provide fast feedback, they cannot catch issues that only surface when interacting with real testnet infrastructure:

- Transaction ordering and ledger timing edge cases
- Soroban CLI behavior mismatches between `testutils` and real RPC
- Event emission and storage persistence across ledger boundaries
- Fee dynamics and resource (CPU/memory) limit behavior
- Emergency stop / circuit breaker interactions with real tx sequencing

### What's Included

#### 1. Mock Reflector Oracle Contract (`contracts/mock-reflector/`)

A minimal Soroban contract that implements the same interface as a real Reflector oracle, returning **fixed prices of 100.00 USD** with the current ledger timestamp. This allows testnet integration tests to run deterministically without depending on a real oracle deployment.

```
contracts/mock-reflector/
├── Cargo.toml          # Contract manifest with soroban-sdk 21.0.0
└── src/
    └── lib.rs          # MockReflector: base(), assets(), decimals(), lastprice(), twap()
```

**Key design decisions:**
- Uses the current ledger timestamp for prices so they never appear stale
- Returns 14-decimal precision matching `REFLECTOR_PRICE_DECIMALS`
- Imports `Asset` and `PriceData` types from the main `portfolio-rebalancer` crate
- Compiled as a separate WASM binary and deployed alongside the rebalancer on testnet

#### 2. Testnet Integration Test Suite (`contracts/tests/testnet_integration.rs`)

A comprehensive test file with **5 test cases** covering the full contract lifecycle on real Stellar testnet:

| # | Test | Description |
|---|------|-------------|
| 1 | `testnet_full_rebalance_lifecycle` | Deploy → initialize → create → deposit → rebalance → verify state & events |
| 2 | `testnet_fractional_three_way_allocations` | Three-way 33.33/33.33/33.34% allocations with drift preview |
| 3 | `testnet_emergency_stop_flow` | Emergency stop blocks rebalance → re-enable → rebalance succeeds |
| 4 | `testnet_config_and_capability_views` | config_view, capability_summary, version endpoints |
| 5 | `testnet_fee_config_flow` | Default fee config → set fee config → verify configuration |

**Test infrastructure features:**
- CLI helper functions: `soroban()`, `contract_invoke()`, `contract_simulate()`, `deploy_contract()`
- Transaction hash logging for observability
- Contract event querying and verification
- `TestnetFixture` pattern for one-time deployment shared within each test
- Single-threaded execution (`--test-threads=1`) to avoid nonce conflicts
- Requires `STELLAR_TESTNET_SECRET_KEY` environment variable (a funded testnet account)

#### 3. CI Workflow Changes (`.github/workflows/integration-tests.yml`)

**New triggers:**
- `schedule` — Nightly run at 4:00 AM UTC to catch regressions against live testnet
- `workflow_dispatch` — Manual trigger for ad-hoc testnet integration runs

**Job separation:**
- `integration-tests` job (always runs on PRs/pushes): runs **mock-based integration tests only** (`cargo test integration_`), skipping testnet tests to avoid consuming testnet resources on every PR
- `testnet-integration` job (nightly + manual only): deploys both contracts to testnet, runs the full on-chain test suite with a 30-minute timeout

**Key details:**
- Separate Cargo cache key that includes `contracts/mock-reflector/Cargo.lock`
- Soroban CLI installed via `cargo install --locked soroban-cli`
- Builds both contracts via `make build-testnet`
- Posts a summary step to the workflow run with network info and trigger method
- Guard check ensures `STELLAR_TESTNET_SECRET_KEY` secret exists before proceeding

#### 4. Makefile Additions (`contracts/Makefile`)

| Target | Description |
|--------|-------------|
| `build-mock-reflector` | Build the mock reflector contract to WASM |
| `build-testnet` | Build both the rebalancer and mock reflector |
| `testnet-integration` | Build + run testnet tests (requires `STELLAR_TESTNET_SECRET_KEY`) |
| `testnet-only` | Run only on-chain testnet tests (build then test) |
| `test-integration` | Run local mock-based integration tests (no network) |
| `help` | Updated with all new targets |

### How to Run Locally

```bash
# 1. Set up your testnet account
export STELLAR_TESTNET_SECRET_KEY="S..."

# 2. Build both contracts
cd contracts
make build-testnet

# 3. Run testnet integration tests
make testnet-integration

# Or run only the mock-based tests (no network required)
make test-integration
```

### File Change Summary

| File | Additions | Deletions | Notes |
|------|-----------|-----------|-------|
| `.github/workflows/integration-tests.yml` | +73 | -4 | Nightly + dispatch triggers, new testnet job |
| `contracts/Makefile` | +53 | 0 | New build/test targets |
| `contracts/mock-reflector/Cargo.toml` | +25 | 0 | New mock contract manifest |
| `contracts/mock-reflector/src/lib.rs` | +42 | 0 | Mock oracle implementation |
| `contracts/tests/testnet_integration.rs` | +705 | -9 | 5 comprehensive testnet integration tests |
| **Total** | **+898** | **-13** | |

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [x] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [x] DevOps / CI / Documentation update

## 📖 API Changes & Breaking Changes Checklist

- [x] No API changes — contract interface remains the same
- [x] No breaking changes to existing functionality
- [x] Mock reflector is a separate contract, does not modify the rebalancer

## Checklist

- [x] My code follows the style guidelines of this project
- [x] I have performed a self-review of my own code
- [x] I have commented my code, particularly in hard-to-understand areas
- [x] I have made corresponding changes to the documentation (Makefile help)
- [x] My changes generate no new warnings
- [x] **This PR links to an issue:** Fixes #964
- [x] I have added tests that prove my fix is effective or that my feature works
- [x] New and existing unit tests pass locally with my changes

### Future Considerations

- Add a **health check** step that verifies the testnet account balance is sufficient before running tests
- Add **performance benchmarks** that measure contract resource usage differences between mock and real testnet
- Consider adding a **mainnet staging** test suite using a dedicated low-value mainnet account for pre-deployment validation
- Add **failure injection tests** (e.g., insufficient balance, expired ledger entries)
