# Contract events and backend indexer compatibility

The backend `ContractEventIndexerService` (`backend/src/services/contractEventIndexer.ts`) subscribes to Soroban **contract** events for the configured portfolio contract and maps them into rebalance history rows.

For the frontend-facing view of supported methods, expected arguments, and graceful-degradation behaviour, see the [Contract Capability Matrix & Frontend Compatibility Guide](CONTRACT_CAPABILITY_MATRIX.md).

## Schema version

- **Code constant:** `BACKEND_CONTRACT_EVENT_SCHEMA_VERSION` in `backend/src/config/contractEventSchema.ts`.
- **Environment:** `CONTRACT_EVENT_SCHEMA_VERSION` (optional). If set, it **must** equal the code constant or every `syncOnce` call becomes a no-op and `lastError` describes the mismatch. Readiness treats an enabled indexer with a failed schema check as **not ready**.

Bump the constant when you change topic strings or tuple layouts expected below, and document the migration for deployers.

## Event conventions

All portfolio lifecycle events share these rules (see `contracts/src/portfolio.rs` emit helpers):

| Rule | Value |
|------|--------|
| Topic domain | `portfolio` (topic index 0) |
| Payload index 0 | `portfolio_id: u64` |
| Timestamps | `u64` ledger timestamp at the last payload field when present |
| Asset + amount events | `(portfolio_id, asset: Address, amount: i128)` |

## Expected event topics and payloads

Aligned with `contracts/src/lib.rs` and `contracts/src/portfolio.rs`.

| Topic[0] | Topic[1] | Payload shape (Rust tuple) | Indexed as |
|----------|----------|------------------------------|------------|
| `portfolio` | `created` | `(portfolio_id, user)` | `portfolio_created` |
| `portfolio` | `deposit` | `(portfolio_id, asset, amount)` | `deposit` |
| `portfolio` | `withdraw` | `(portfolio_id, asset, amount)` | `withdraw` |
| `portfolio` | `rebalanced` | `(portfolio_id, timestamp)` | `rebalance_executed` |
| `portfolio` | `cooldown_override` | `(portfolio_id, admin, timestamp)` | (audit only; not indexed by default) |
| Topic[0] | Topic[1] | Payload shape (Rust) | Indexed as |
|----------|----------|----------------------|------------|
| `portfolio` | `created` | `(portfolio_id: u64, user: Address)` | `portfolio_created` |
| `portfolio` | `deposit` | `(portfolio_id: u64, asset: Address, amount: i128, memo: String)` | `deposit` |
| `portfolio` | `rebalanced` | `(portfolio_id: u64, current_time: u64)` | `rebalance_executed` |
| `portfolio` | `fee_charged` | `(portfolio_id: u64, recipient: Address, amount: i128)` | `fee_charged` |
| `portfolio` | `upgraded` | `(from_hash: Bytes, to_hash: Bytes, timestamp: u64)` | `contract_upgraded` |

**Synonyms:** the indexer accepts `rebalance_executed` or `executed` as the second topic for the rebalance event (same payload rules).

The `deposit` event now includes a `memo: String` field at tuple index `3`. Backend indexers must decode the 4-tuple `(u64, Address, i128, String)` instead of the previous 3-tuple.

## Payload parsing (backend)

- **Portfolio id:** tuple index `0`, or object keys `portfolioId`, `portfolio_id`, `id`.
- **User (created):** tuple index `1`, or object keys `user`, `userAddress`, `user_address`.
- **Asset (deposit / withdraw):** tuple index `1`.
- **Amount (deposit / withdraw):** tuple index `2`.
- **Timestamp (rebalanced / cooldown_override):** tuple index `1` for rebalanced; index `2` for cooldown_override when admin is at index `1`.
- **Memo (deposit):** tuple index `3`, or object keys `memo`.

Events from other contracts or with unknown second topics are skipped without failing the batch.

## Reusable test fixtures

The contract test suite emits canonical event sequences that backend integration tests can replay.

### Fixture usage

1. Run the contract tests to generate snapshot files:
   ```bash
   cd contracts && cargo test
   ```

2. Snapshot JSON files are written to `contracts/test_snapshots/test/`. Each file captures the full Soroban test environment after a test completes, including all emitted events.

3. Backend tests can load these snapshots and extract events using the `SorobanEvent` schema defined in `backend/src/services/contractEventIndexer.ts`.

### Available fixture files

| Fixture | Events produced | Description |
|---------|----------------|-------------|
| `test_create_portfolio.1.json` | `portfolio.created` | Portfolio creation with allocations |
| `test_deposit_valid.1.json` | `portfolio.created`, `portfolio.deposit` | Valid deposit with memo |
| `test_deposit_with_memo.1.json` | `portfolio.created`, `portfolio.deposit` | Deposit with explicit reference memo |
| `test_execute_rebalance_success.1.json` | `portfolio.created`, `portfolio.deposit`, `portfolio.rebalanced` | Full rebalance lifecycle |
| `test_set_fee_config.1.json` | `portfolio.created`, `portfolio.rebalanced`, `portfolio.fee_charged` | Rebalance with fee config enabled |

### Exporting fixtures for external use

To export events as standalone JSON (e.g., for CI or backend tests):

```bash
# Copy relevant snapshots to a fixtures directory
cp contracts/test_snapshots/test/test_deposit_with_memo.1.json backend/tests/fixtures/
cp contracts/test_snapshots/test/test_execute_rebalance_success.1.json backend/tests/fixtures/
```

The `test_contract_events_fixture_export` test in `contracts/src/test.rs` validates that events are emitted with the expected shapes and can be replayed.

## Operational notes

- Indexer requires non-empty `CONTRACT_ADDRESS` or `STELLAR_CONTRACT_ADDRESS` and an RPC URL (see `backend/.env.example`).
- Polling `start()` may not run unless something invokes it; history routes can call `syncOnce()` on demand.

## Related tests

- `contracts/src/test.rs` — Soroban contract tests that produce event snapshot fixtures.
- `backend/src/test/contractEventSchema.test.ts` — version string parsing and mismatch behavior.
- `contracts/src/test.rs` — Soroban integration tests and snapshot fixtures for contract calls.
