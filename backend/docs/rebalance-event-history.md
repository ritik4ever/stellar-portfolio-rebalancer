# Rebalance Event History

The rebalance event history is the audit trail of every rebalance, whether it
was triggered from the dashboard, by the auto-rebalancer, or confirmed on-chain
by the contract event indexer. This note documents the two guarantees the
history relies on: a **stable order** and **no duplicate events** (#2104).

## Ordering

History is read newest first. The sort key is a total order, so two events that
share a timestamp — for example two events confirmed in the same ledger, which
share the ledger close time — always come back in the same order:

| Priority | Column | Direction | Notes |
| --- | --- | --- | --- |
| 1 | `timestamp` | `DESC` | Event time; for on-chain events this is the ledger close time |
| 2 | `on_chain_paging_token` | `DESC` (`NULLS LAST`) | Chain order inside a ledger |
| 3 | `id` | `DESC` | Final tiebreaker, so the order is total |

The paging token is the only chain-order signal available for events that share
a timestamp, so it is used before the row id. Events without a paging token
(off-chain and simulated events) fall back to the id tiebreaker.

The SQLite adapter (`services/databaseService.ts`) and the Postgres adapter
(`db/rebalanceHistoryDb.ts`) apply the same rule. The Postgres side only
applies the id tiebreaker because no migration adds
`on_chain_paging_token` to `rebalance_events` yet; Postgres rows never carry a
paging token today, so the effective order is identical.

## Duplicate events and replayed pages

On-chain events are deduplicated by the paging token. Both storage backends
have a unique partial index over `on_chain_paging_token`, and the write uses
`ON CONFLICT … DO NOTHING`, so:

- the **first** write of an event creates the row;
- a **replay** of the same event keeps the original row untouched and never
  creates a second one.

`DatabaseService.recordRebalanceEventOnce()` reports which of the two happened:

```ts
const { event, inserted } = databaseService.recordRebalanceEventOnce(payload)
```

`inserted` is `false` when the event was already recorded. The indexer only
counts events it actually created towards `ingested`, so replaying a page that
was recorded earlier reports `0` new events instead of counting work that was
already done. `recordRebalanceEvent()` keeps its previous signature and returns
the same event object as before.

The indexer additionally keeps an in-memory set of paging tokens to skip
events it has already seen in the current process. That cache is an
optimisation only — the database constraint is the durable boundary, so a
restart that replays a page still cannot create duplicates.

## Test coverage

`test/rebalanceEventHistoryEdgeCases.test.ts` runs the real indexer against a
private SQLite file and a stubbed RPC and covers:

- two events confirmed in one ledger are both recorded once and come back in a
  deterministic order that does not change between reads;
- an indexer that replays a previously recorded page creates no duplicate rows,
  keeps the original rows, and reports no ingested work.

`test/contractEventIndexer.test.ts` and
`test/contractEventIndexerRecovery.test.ts` cover the indexer itself against
the same storage contract.
