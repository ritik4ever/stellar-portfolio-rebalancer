# Operations handbook

How background jobs, queues, the contract indexer, and health checks fit together when you run or debug the backend locally or in Docker.

## Redis and queues

- **BullMQ** drives scheduled work: portfolio checks, rebalance jobs, analytics snapshots, and idempotency key cleanup.
- **Connection:** `REDIS_URL` (default `redis://localhost:6379`). If Redis is unreachable, `probeRedis()` reports unavailable and the HTTP API still starts; queue-backed features are degraded.
- **Scheduler:** When Redis is up, `startQueueScheduler()` (from `backend/src/queue/scheduler.ts`) registers repeatable cron jobs and enqueues one-off startup jobs (portfolio check, analytics snapshot, idempotency cleanup).
- **Queues:** Defined in `backend/src/queue/queues.js` (`portfolio-check`, `rebalance`, `analytics-snapshot`, `idempotency-cleanup`). Without Redis, queue getters return `null` and workers do not attach.

## Worker startup

- Worker implementations live under `backend/src/queue/workers/` (`portfolioCheckWorker`, `rebalanceWorker`, `analyticsSnapshotWorker`, `idempotencyCleanupWorker`). Each exposes `start*Worker` / `stop*Worker` and runtime status used by readiness and ops routes.
- **Important:** The default `npm run dev` / `npm start` entrypoint (`backend/src/index.ts`) registers the **scheduler** when Redis is available; it does **not** automatically spawn BullMQ worker processes. For full queue processing in development you need a process that calls the worker starters (or a dedicated worker entrypoint your deployment provides). Until workers run, jobs accumulate in Redis and `/ready` may report workers as not ready.
- **Docker Compose:** The `backend` service runs `npm start` only. Ensure `REDIS_URL` points at the `redis` service (e.g. `redis://redis:6379`) if you expect queues to function. The optional `monitoring` profile runs another Node process on a separate port for observability stacks—see `deployment/docker-compose.yml`.

## Contract event indexer

- **Code:** `backend/src/services/contractEventIndexer.ts`.
- **Enable:** Set `STELLAR_CONTRACT_ADDRESS` or `CONTRACT_ADDRESS` and a Soroban RPC URL (`SOROBAN_RPC_URL`, `STELLAR_RPC_URL`, or network default). Without both, the indexer stays disabled.
- **Manual sync:** Admin/API routes can trigger `contractEventIndexerService.syncOnce()` for a forced pull outside the poll interval.
- **Readiness:** `/ready` marks the indexer `disabled` when not configured, or `not_ready` until a successful startup sync completes (`lastSuccessfulRunAt` set, no `lastError`).

### Durable cursor

The indexer persists two keys in the `kv_store` table:

| Key | Purpose |
|-----|---------|
| `soroban_event_indexer.cursor` | Soroban RPC paging token for incremental event fetch |
| `soroban_event_indexer.latest_ledger` | Last known ledger sequence from RPC response |

The cursor is written only after a batch completes successfully. If the process crashes mid-batch the same events are re-fetched on restart; this is safe because rebalance history rows are keyed by UUID and duplicates do not affect correctness.

**Startup resume logic:**

1. Cursor in DB — resume from that paging token.
2. No cursor, but `latest_ledger` stored — start from `latest_ledger - 1`.
3. Neither exists (fresh DB) — bootstrap from `chain_tip - SOROBAN_EVENT_INDEXER_BOOTSTRAP_WINDOW` (default 500 ledgers).

### Inspecting indexer position

- **API:** `GET /api/v1/indexer/cursor` returns stored cursor, latest ledger, last successful/failed sync timestamps, and errors.
- **SQL:** `SELECT * FROM kv_store WHERE key LIKE 'soroban_event_indexer%'`

### Re-sync and backfill

Use the CLI script to reset the cursor and replay on-chain history:

```bash
cd backend
npx tsx scripts/reindex-events.ts --full                   # full reindex from bootstrap window
npx tsx scripts/reindex-events.ts --from-ledger 12345      # backfill from a specific ledger
npx tsx scripts/reindex-events.ts --full --dry-run         # preview without writing to DB
```

The script requires `ADMIN_REINDEX_KEY` to be set (matches the env var on the server) to prevent accidental runs. See `backend/scripts/reindex-events.ts` for details.

### RPC resilience

The indexer uses bounded exponential backoff when the Soroban RPC is unreachable. It tracks last successful sync time, last failed sync time, and a ring buffer of recent error summaries. These are exposed through the `/api/v1/indexer/cursor` and `/ready` endpoints so operators can tell whether the indexer is healthy, catching up, or stuck.

## Health vs readiness

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Plain `200` + `ok` — process up (root `index.ts`). |
| `GET /api/health` | JSON `{ status, timestamp }` — API router health. |
| `GET /ready` / `GET /readiness` | Deep probe: database, Redis/queues, worker runtime status, indexer, auto-rebalancer initialization (`backend/src/monitoring/readiness.ts`). Returns `503` when `status !== 'ready'`. |

Use `/health` for load balancer liveness. Use `/ready` before traffic shifts in environments that depend on Redis, workers, or the indexer.

## Safe shutdown and restart

- **Process stop:** Stopping Node terminates open HTTP and WebSocket connections. BullMQ workers in the same process should be stopped with their `stop*Worker` helpers before exit if you add a worker host; repeatable jobs remain in Redis until removed via `stopQueueScheduler()`.
- **Redis restart:** Queues and repeatable job metadata live in Redis. After Redis comes back, restart the API so `probeRedis()` and `startQueueScheduler()` run again; workers must reconnect via `getConnectionOptions()`.
- **Database:** SQLite (`DB_PATH`) or PostgreSQL (`DATABASE_URL`) holds application data and indexer cursors. Deleting the DB resets consent and portfolios; indexer cursors reset to bootstrap behavior on next start.

## Related docs

- Contributor setup: [docs/CONTRIBUTING.md](CONTRIBUTING.md)
- OpenAPI source of truth: [backend/docs/openapi.md](../backend/docs/openapi.md)
