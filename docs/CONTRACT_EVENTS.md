# Contract events and backend indexer compatibility

The backend `ContractEventIndexerService` (`backend/src/services/contractEventIndexer.ts`) subscribes to Soroban **contract** events for the configured portfolio contract and maps them into rebalance history rows.

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

**Synonyms:** the indexer accepts `rebalance_executed` or `executed` as the second topic for the rebalance event (same payload rules).

## Payload parsing (backend)

- **Portfolio id:** tuple index `0`, or object keys `portfolioId`, `portfolio_id`, `id`.
- **User (created):** tuple index `1`, or object keys `user`, `userAddress`, `user_address`.
- **Asset (deposit / withdraw):** tuple index `1`.
- **Amount (deposit / withdraw):** tuple index `2`.
- **Timestamp (rebalanced / cooldown_override):** tuple index `1` for rebalanced; index `2` for cooldown_override when admin is at index `1`.

Events from other contracts or with unknown second topics are skipped without failing the batch.

## Operational notes

- Indexer requires non-empty `CONTRACT_ADDRESS` or `STELLAR_CONTRACT_ADDRESS` and an RPC URL (see `backend/.env.example`).
- Polling `start()` may not run unless something invokes it; history routes can call `syncOnce()` on demand.

## Related tests

- `backend/src/test/contractEventSchema.test.ts` — version string parsing and mismatch behavior.
- `contracts/src/test.rs` — Soroban integration tests and snapshot fixtures for contract calls.
