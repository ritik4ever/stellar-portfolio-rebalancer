# Contract events and backend indexer compatibility

The backend `ContractEventIndexerService` (`backend/src/services/contractEventIndexer.ts`) subscribes to Soroban **contract** events for the configured portfolio contract and maps them into rebalance history rows.

For the frontend-facing view of supported methods, expected arguments, and graceful-degradation behaviour, see the [Contract Capability Matrix & Frontend Compatibility Guide](CONTRACT_CAPABILITY_MATRIX.md).

## Schema version

* **Code constant:** `BACKEND_CONTRACT_EVENT_SCHEMA_VERSION` in `backend/src/config/contractEventSchema.ts`.
* **Environment:** `CONTRACT_EVENT_SCHEMA_VERSION` (optional). If set, it **must** equal the code constant or every `syncOnce` call becomes a no-op and `lastError` describes the mismatch. Readiness treats an enabled indexer with a failed schema check as **not ready**.

Bump the constant when you change topic strings or tuple layouts expected below, and document the migration for deployers.

## Correlation-ID module decision

Contract events do not currently include application correlation IDs in their topics or payloads.

The former `contracts/src/events.rs` module was removed because it was not declared by `contracts/src/lib.rs`, its correlation-ID helpers were not called by active contract entrypoints, and active portfolio events are already emitted from their existing contract modules.

The remaining stale `events` import and DCA event call were removed from `contracts/src/strategies/dca.rs`. The existing DCA entrypoints remain available, but this maintenance change does not introduce a new DCA event or alter the documented event schema.

Backend request correlation IDs remain an off-chain logging and request-context concern. Adding correlation IDs to on-chain events in the future should be handled as an intentional schema change, including contract entrypoint design, event payload updates, backend decoder changes, documentation, and schema-version review.

## Event conventions

All portfolio lifecycle events share these rules (see `contracts/src/portfolio.rs` emit helpers):

| Rule                  | Value                                                         |
| --------------------- | ------------------------------------------------------------- |
| Topic domain          | `portfolio` (topic index 0)                                   |
| Payload index 0       | `portfolio_id: u64`                                           |
| Timestamps            | `u64` ledger timestamp at the last payload field when present |
| Asset + amount events | `(portfolio_id, asset: Address, amount: i128)`                |

## Event payload changes for strategy-aware portfolios

Starting from `CONTRACT_VERSION = 2`, newly created portfolios include `strategy: StrategyType` and `strategy_config: StrategyConfig` fields (see `contracts/src/types.rs`). The `Portfolio` struct stored under `DataKey::PortfolioV2` now contains:

- `strategy: StrategyType` — `Threshold (0)`, `Periodic (1)`, `Volatility (2)`, or `Custom (3)`
- `strategy_config: StrategyConfig` — `{ interval_seconds, volatility_threshold_bps, min_interval_seconds }`

Legacy portfolios (created before the schema bump) are migrated on first read: the old XDR is deserialized as `LegacyPortfolio`, converted with `StrategyType::Threshold` + default `StrategyConfig`, and re-written under `DataKey::PortfolioV2`. Old entries under `DataKey::Portfolio(u64)` are removed after migration.

Event topics and payload shapes remain unchanged — the strategy fields are storage-only and do not alter event payloads. Backend indexers that decode `Portfolio` from events (e.g. `portfolio.created`) will see the new fields automatically once old portfolios are migrated.

## Expected event topics and payloads

Aligned with `contracts/src/lib.rs` and `contracts/src/portfolio.rs`.

| Topic[0]    | Topic[1]            | Payload shape (Rust tuple)                                        | Indexed as                           |
| ----------- | ------------------- | ----------------------------------------------------------------- | ------------------------------------ |
| `portfolio` | `created`           | `(portfolio_id, user)`                                            | `portfolio_created`                  |
| `portfolio` | `deposit`           | `(portfolio_id, asset, amount)`                                   | `deposit`                            |
| `portfolio` | `withdraw`          | `(portfolio_id, asset, amount)`                                   | `withdraw`                           |
| `portfolio` | `rebalanced`        | `(portfolio_id, timestamp)`                                       | `rebalance_executed`                 |
| `portfolio` | `cooldown_override` | `(portfolio_id, admin, timestamp)`                                | (audit only; not indexed by default) |
| Topic[0]    | Topic[1]            | Payload shape (Rust)                                              | Indexed as                           |
| ----------  | ----------          | ----------------------                                            | ------------                         |
| `portfolio` | `created`           | `(portfolio_id: u64, user: Address)`                              | `portfolio_created`                  |
| `portfolio` | `deposit`           | `(portfolio_id: u64, asset: Address, amount: i128, memo: String)` | `deposit`                            |
| `portfolio` | `rebalanced`        | `(portfolio_id: u64, current_time: u64)`                          | `rebalance_executed`                 |
| `portfolio` | `fee_charged`       | `(portfolio_id: u64, recipient: Address, amount: i128)`           | `fee_charged`                        |
| `portfolio` | `upgraded`          | `(from_hash: Bytes, to_hash: Bytes, timestamp: u64)`              | `contract_upgraded`                  |
| Topic[0] | Topic[1] | Payload shape (Rust tuple) | Indexed as |
|----------|----------|------------------------------|------------|
| `portfolio` | `created` | `(portfolio_id, user)` | `portfolio_created` |
| `portfolio` | `deposit` | `(portfolio_id, asset, amount)` | `deposit` |
| `portfolio` | `withdraw` | `(portfolio_id, asset, amount)` | `withdraw` |
| `portfolio` | `rebalanced` | `(portfolio_id, timestamp)` | `rebalance_executed` |
| `portfolio` | `cooldown_override` | `(portfolio_id, admin, timestamp)` | (audit only; not indexed by default) |
| `portfolio` | `alloc_upd` | `(portfolio_id, old_allocations, new_allocations)` | `allocation_updated` |
| Topic[0] | Topic[1] | Payload shape (Rust) | Indexed as |
|----------|----------|----------------------|------------|
| `portfolio` | `created` | `(portfolio_id: u64, user: Address)` | `portfolio_created` |
| `portfolio` | `deposit` | `(portfolio_id: u64, asset: Address, amount: i128, memo: String)` | `deposit` |
| `portfolio` | `rebalanced` | `(portfolio_id: u64, current_time: u64)` | `rebalance_executed` |
| `portfolio` | `fee_charged` | `(portfolio_id: u64, recipient: Address, amount: i128)` | `fee_charged` |
| `portfolio` | `upgraded` | `(from_hash: Bytes, to_hash: Bytes, timestamp: u64)` | `contract_upgraded` |
| `portfolio` | `alloc_upd` | `(portfolio_id: u64, old_allocations: Map<Address, u32>, new_allocations: Map<Address, u32>)` | `allocation_updated` |

**Synonyms:** the indexer accepts `rebalance_executed` or `executed` as the second topic for the rebalance event (same payload rules).

### Governance: two-step admin transfer

Admin handover does not use the `portfolio` topic domain — both events are topic-indexed by the **admin address acting at that step**, so a watcher can filter on the outgoing admin:

| Topic[0]             | Topic[1]                  | Payload      | Emitted by       |
| -------------------- | ------------------------- | ------------ | ---------------- |
| `admin_proposed`     | `current_admin: Address`  | `Address`    | `propose_admin`  |
| `admin_transferred`  | `previous_admin: Address` | `Address`    | `accept_admin`   |

The payload is the incoming admin in both cases: the nominee for `admin_proposed`, the address that actually took the role for `admin_transferred`.

Because the transfer is two-step, `admin_proposed` is **not** a change of authority — `DataKey::Admin` is untouched until the matching `admin_transferred` lands. A proposal may be superseded by a later `admin_proposed` from the same admin (the newest nomination wins) and may never be accepted at all, so consumers must treat `admin_transferred` as the only authoritative signal that the admin changed. There is no single-call `set_admin`: after `initialize`, every admin change produces exactly this pair of events.

The `deposit` event now includes a `memo: String` field at tuple index `3`. Backend indexers must decode the 4-tuple `(u64, Address, i128, String)` instead of the previous 3-tuple.

## Payload parsing (backend)

- **Portfolio id:** tuple index `0`, or object keys `portfolioId`, `portfolio_id`, `id`.
- **User (created):** tuple index `1`, or object keys `user`, `userAddress`, `user_address`.
- **Asset (deposit / withdraw):** tuple index `1`.
- **Amount (deposit / withdraw):** tuple index `2`.
- **Timestamp (rebalanced / cooldown_override):** tuple index `1` for rebalanced; index `2` for cooldown_override when admin is at index `1`.
- **Memo (deposit):** tuple index `3`, or object keys `memo`.
- **Old allocations (alloc_upd):** tuple index `1`, `Map<Address, u32>` of previous target allocations.
- **New allocations (alloc_upd):** tuple index `2`, `Map<Address, u32>` of updated target allocations.

Events from other contracts or with unknown second topics are skipped without failing the batch.

### `alloc_upd` event details

Emitted by the `update_allocations` entrypoint when a user changes a portfolio's target allocation percentages.

**Contract entrypoint:** `update_allocations(portfolio_id: u64, new_allocations: Map<Address, u32>)` — see [`contracts/src/lib.rs`](../contracts/src/lib.rs) and the [Contract Capability Matrix](CONTRACT_CAPABILITY_MATRIX.md) (`update_allocations` row).

**Emit source:** `contracts/src/events.rs` (`emit_allocation_updated`) and inline in `contracts/src/lib.rs`.

**Sample event payload:**

```json
{
  "type": "contract",
  "topics": ["portfolio", "alloc_upd"],
  "data": {
    "portfolio_id": 1,
    "old_allocations": {
      "CDLZFC...XLM": 40,
      "CDMLFK...USDC": 35,
      "CBKTPM...BTC": 25
    },
    "new_allocations": {
      "CDLZFC...XLM": 50,
      "CDMLFK...USDC": 30,
      "CBKTPM...BTC": 20
    }
  }
}
```

> **Note:** The `events.rs` helper (`emit_allocation_updated`) emits the event with topics `(alloc_upd, invoker, correlation_id)` and payload `portfolio_id`. The inline emit in `lib.rs` uses topics `(portfolio, alloc_upd)` with payload `(portfolio_id, old_allocations, new_allocations)`. Backend indexers should handle both shapes.

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

| Fixture                                 | Events produced                                                      | Description                          |
| --------------------------------------- | -------------------------------------------------------------------- | ------------------------------------ |
| `test_create_portfolio.1.json`          | `portfolio.created`                                                  | Portfolio creation with allocations  |
| `test_deposit_valid.1.json`             | `portfolio.created`, `portfolio.deposit`                             | Valid deposit with memo              |
| `test_deposit_with_memo.1.json`         | `portfolio.created`, `portfolio.deposit`                             | Deposit with explicit reference memo |
| `test_execute_rebalance_success.1.json` | `portfolio.created`, `portfolio.deposit`, `portfolio.rebalanced`     | Full rebalance lifecycle             |
| `test_set_fee_config.1.json`            | `portfolio.created`, `portfolio.rebalanced`, `portfolio.fee_charged` | Rebalance with fee config enabled    |
| Fixture | Events produced | Description |
|---------|----------------|-------------|
| `test_create_portfolio.1.json` | `portfolio.created` | Portfolio creation with allocations |
| `test_deposit_valid.1.json` | `portfolio.created`, `portfolio.deposit` | Valid deposit with memo |
| `test_deposit_with_memo.1.json` | `portfolio.created`, `portfolio.deposit` | Deposit with explicit reference memo |
| `test_execute_rebalance_success.1.json` | `portfolio.created`, `portfolio.deposit`, `portfolio.rebalanced` | Full rebalance lifecycle |
| `test_set_fee_config.1.json` | `portfolio.created`, `portfolio.rebalanced`, `portfolio.fee_charged` | Rebalance with fee config enabled |
| `test_update_allocations_success.1.json` | `portfolio.created`, `portfolio.alloc_upd` | Allocation update with old and new maps |

### Exporting fixtures for external use

To export events as standalone JSON (for example, for CI or backend tests):

```bash
# Copy relevant snapshots to a fixtures directory
cp contracts/test_snapshots/test/test_deposit_with_memo.1.json backend/tests/fixtures/
cp contracts/test_snapshots/test/test_execute_rebalance_success.1.json backend/tests/fixtures/
```

The `test_contract_events_fixture_export` test in `contracts/src/test.rs` validates that events are emitted with the expected shapes and can be replayed.

## Operational notes

* Indexer requires non-empty `CONTRACT_ADDRESS` or `STELLAR_CONTRACT_ADDRESS` and an RPC URL (see `backend/.env.example`).
* Polling `start()` may not run unless something invokes it; history routes can call `syncOnce()` on demand.

## Related tests

- `contracts/src/test.rs` — Soroban contract tests that produce event snapshot fixtures.
- `backend/src/test/contractEventSchema.test.ts` — version string parsing and mismatch behavior.
- `contracts/src/test.rs` — Soroban integration tests and snapshot fixtures for contract calls.
- `contracts/src/test.rs` (`test_update_allocations_success`) — Verifies `alloc_upd` event emission with correct old/new allocation maps.
