# Database migrations

## Contract upgrade checklist

When upgrading the Soroban contract WASM, follow this checklist to avoid storage incompatibilities:

### Pre-upgrade

1. **Compute current WASM hash**:
   ```bash
   soroban contract wasm hash --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm
   ```
   Save this hash for rollback.

2. **Check storage shape**:
   - Review `DataKey` variants in `contracts/src/types.rs`. New variants are safe; renamed or removed variants are **breaking**.
   - Review `Portfolio` struct fields. Adding fields is safe for new portfolios; existing entries remain deserializable only if your upgrade code handles legacy data (e.g., via migration).
   - If storage layout changes, write a migration function invoked during `upgrade()` before calling `update_current_contract_wasm`.

3. **Backup the current WASM artifact**:
   ```bash
   cp target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm previous.wasm
   ```

4. **Verify test snapshots pass**:
   ```bash
   make test
   ```
   Snapshot fixtures in `test_snapshots/` must match the new behavior before deploying.

### Upgrade steps

```bash
# 1. Install new WASM blob (returns hash)
NEW_HASH=$(soroban contract install \
  --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm \
  --source $STELLAR_SECRET_KEY \
  --network $STELLAR_NETWORK)

# 2. Point contract instance to new WASM
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $STELLAR_SECRET_KEY \
  --network $STELLAR_NETWORK \
  -- upgrade \
  --new_wasm_hash $NEW_HASH

# 3. Verify upgrade event was emitted
# Check for ("portfolio","upgraded") event with from_hash, to_hash, timestamp.
```

### Rollback

```bash
# Point contract back to previous WASM hash
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $STELLAR_SECRET_KEY \
  --network $STELLAR_NETWORK \
  -- upgrade \
  --new_wasm_hash $PREVIOUS_HASH
```

### Storage compatibility notes

| Storage change | Compatibility | Migration needed? |
|---|---|---|
| Add `DataKey` variant | Safe | No |
| Rename/remove `DataKey` variant | Breaking | Yes |
| Add field to `Portfolio` | Safe for new entries | Yes for existing entries |
| Remove field from `Portfolio` | Breaking | Yes |
| Add new event topic | Safe | No |
| Change event payload shape | Breaking (indexer) | Yes, update `CONTRACT_EVENTS.md` |

---

## Schema-version-2 contract migration

This section covers the on-chain storage migration from schema version 1 to
schema version 2. It applies when the contract's `migrate_storage` hook is
implemented and the upgrade introduces storage-layout changes that cannot be
handled by a simple WASM swap alone.

> [!NOTE]
> As of the current release, the `migrate_storage` hook is implemented and
> schema-version-2 storage layout changes are supported. Steps marked
> **TODO** indicate entrypoints that may change if the hook is exposed
> differently.

### Overview

Schema-version migrations go beyond a plain WASM upgrade. When a contract
release changes the shape of persistent storage entries — for example, adds
new fields to `Portfolio`, introduces new `DataKey` variants, or changes the
serialization of existing keys — existing on-chain data must be transformed
to remain compatible with the new code.

In schema version 2, the following changes apply:

| Field / key | Change |
|---|---|
| `Portfolio` struct | New fields: `custody_provider` (`CustodyProvider`) and `strategy_profile` (`StrategyProfile`) |
| `DataKey` | New variant `DataKey::Strategy` for per-portfolio strategy configuration |
| `DataKey::Portfolio` | Serialization changed to include the new `Portfolio` fields |
| `PortfolioRebalanced` event | Topic extended with `strategy_id`; payload adds `strategy` object |

The `migrate_storage` hook (once implemented) provides a deterministic
in-contract function that is invoked during `upgrade()`, **before** the new
WASM is activated. This ensures storage is consistent before any new code
reads or writes it.

| Constant | Current value | Location |
|---|---|---|
| `CONTRACT_VERSION` | `1` | `contracts/src/types.rs` |
| `CONTRACT_EVENT_SCHEMA_VERSION` | `1` | `contracts/src/types.rs` |
| Backend schema version | `1` | `backend/src/config/contractEventSchema.ts` |
| Frontend schema version | `1` | `frontend/src/lib/contractCapabilities.ts` |

### Migration prerequisites

Before executing a schema-version migration, confirm every item:

- [ ] Target WASM is built from the intended commit and tested:
  ```bash
  cd contracts && make test
  ```
- [ ] Admin key (`STELLAR_SECRET_KEY`) is available and matches the on-chain
  contract admin.
- [ ] Current schema version has been verified on-chain (see
  [Pre-migration checklist](#pre-migration-checklist)).
- [ ] The current WASM hash has been recorded for rollback.
- [ ] Backend and frontend releases that support schema version 2 are ready to
  deploy (or already deployed) so that indexer and UI can handle any event
  payload changes.
- [ ] A database backup exists (if backend schema changes accompany the
  contract upgrade).

### Pre-migration checklist

Run these checks against the live contract **before** triggering `upgrade()`:

1. **Verify current schema version**:
   ```bash
   soroban contract invoke \
     --id $CONTRACT_ID \
     --network $STELLAR_NETWORK \
     -- schema_version
   ```
   Expected output: `1`. If this returns a different value, the contract is
   already migrated or an unexpected deployment is active.

2. **Capture capability baseline**:
   ```bash
   soroban contract invoke \
     --id $CONTRACT_ID \
     --network $STELLAR_NETWORK \
     -- capability_summary
   ```
   Record the returned `version`, `schema_version`, and `capability_flags`
   for post-migration comparison.

3. **Record current WASM hash**:

   Obtain the deployed WASM from the on-chain contract instance rather than
   hashing a local build artifact — the local binary may not match what is
   actually deployed.

   Retrieve the WASM from the contract instance and compute its hash:
   ```bash
   soroban contract wasm fetch --id $CONTRACT_ID --network $STELLAR_NETWORK \
     --out current_deployed.wasm
   CURRENT_HASH=$(soroban contract wasm hash --wasm current_deployed.wasm)
   echo "Current on-chain WASM hash: $CURRENT_HASH"
   ```

   Compare this hash against your deployment records (CI build logs,
   deployment manifests, or the `("portfolio", "upgraded")` event's
   `from_hash` field from the last upgrade). If the hashes do not match,
   investigate the discrepancy before proceeding — the deployed code may
   differ from what you expect.

4. **Snapshot contract state** (optional but recommended):
   - Record the total number of portfolios via event replay or indexer
     query.
   - Note any active portfolio IDs and their last-rebalance timestamps.
   - This data helps verify that migration did not corrupt or lose entries.

### Migration execution steps

> [!TODO]
> The exact CLI for invoking `migrate_storage` depends on how the hook is
> exposed — either as a separate entrypoint or called automatically inside
> `upgrade()`. Update the steps below once the implementation is finalised.

#### Step 1 — Install the new WASM blob

```bash
NEW_HASH=$(soroban contract install \
  --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm \
  --source $STELLAR_SECRET_KEY \
  --network $STELLAR_NETWORK)
```

#### Step 2 — Trigger upgrade with storage migration

If `migrate_storage` is called automatically inside `upgrade()`:

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $STELLAR_SECRET_KEY \
  --network $STELLAR_NETWORK \
  -- upgrade \
  --new_wasm_hash $NEW_HASH
```

If `migrate_storage` is a separate entrypoint that must be called **before**
`upgrade()`:

```bash
# 2a. Run the storage migration against the old WASM
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $STELLAR_SECRET_KEY \
  --network $STELLAR_NETWORK \
  -- migrate_storage

# 2b. Activate the new WASM
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $STELLAR_SECRET_KEY \
  --network $STELLAR_NETWORK \
  -- upgrade \
  --new_wasm_hash $NEW_HASH
```

#### Step 3 — Verify schema version changed

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $STELLAR_NETWORK \
  -- schema_version
```

Expected output: `2`.

#### Step 4 — Verify upgrade event

Check for a `("portfolio", "upgraded")` event with `from_hash`, `to_hash`,
and `timestamp` fields. If `migrate_storage` emits its own event, confirm
it was recorded as well.

#### Step 5 — Verify capability summary

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $STELLAR_NETWORK \
  -- capability_summary
```

Compare `schema_version` and `capability_flags` against the baseline
recorded during pre-migration.

### Post-migration checklist

After the upgrade completes, verify the following:

- [ ] **Schema version** returns `2` (see Step 3 above).
- [ ] **Existing portfolios** deserialize correctly:
  ```bash
  soroban contract invoke \
    --id $CONTRACT_ID \
    --network $STELLAR_NETWORK \
    -- get_portfolio \
    --portfolio_id 1
  ```
  If this fails with a deserialization error, the migration hook may not
  have transformed legacy entries.
- [ ] **Backend indexer** re-syncs without errors. Check the `/readiness`
  endpoint; the `contractEventIndexer` check must report `ready`. If it
  reports `not_ready`, confirm that `BACKEND_CONTRACT_EVENT_SCHEMA_VERSION`
  matches the new contract schema version.
- [ ] **Frontend** startup probe returns `severity: "ok"` (writes enabled).
  If the frontend still expects schema version 1, deploy the updated
  frontend build.
- [ ] **New operations** (create, deposit, withdraw, rebalance) succeed for
  at least one portfolio in a staging/testnet environment.
- [ ] **Event payloads** match the shapes documented in
  [`CONTRACT_EVENTS.md`](CONTRACT_EVENTS.md). If topic strings or tuple
  layouts changed, that document must be updated in the same release.

### Rollback guidance

Rollback behaviour depends on whether `migrate_storage` mutated storage
entries.

#### WASM-only rollback (safe when no storage mutations occurred)

If the upgrade was a plain WASM swap — no `migrate_storage` was invoked or
the hook made no changes — you can roll back by pointing the contract back
to the previous WASM hash:

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $STELLAR_SECRET_KEY \
  --network $STELLAR_NETWORK \
  -- upgrade \
  --new_wasm_hash $PREVIOUS_WASM_HASH
```

After rollback, `schema_version` returns `1` and all original code paths
are restored.

#### Storage-mutation rollback (not reversible by WASM rollback)

If `migrate_storage` transformed storage entries (e.g. added fields to
`Portfolio` entries, restructured `DataKey` values), simply reverting the
WASM hash **will not undo** the storage changes. The new WASM code wrote
data that the old WASM code cannot deserialize, which will cause
`UNEXPECTED_VALUE` or deserialization panics.

In this scenario, recovery options are:

1. **Deploy a corrective contract** with a reverse migration hook that
   restores the original storage shape, then activate the old logic.
2. **Deploy a fresh contract** and re-point the backend and frontend to the
   new contract ID. This is a **data-losing** recovery: the new contract
   starts with empty persistent storage. All on-chain state — portfolio
   records, balances, fee configuration, DCA configurations, and NAV
   history — is left behind in the old contract's storage entries and is
   **not** automatically transferred. Before re-pointing services:
   - Export portfolio records and target allocations from the old contract
     (via event replay or indexer data) so users can re-create them.
   - Communicate to users that they must re-deposit funds into the new
     contract, since asset balances held by the old contract are not
     migrated.
   - The old contract's admin key should be rotated or the emergency stop
     activated to prevent further deposits into the abandoned contract.
   - After re-pointing, verify the new contract is functional by creating
     a test portfolio and executing a full deposit/withdraw/rebalance
     cycle.
3. **Restore from a ledger snapshot** — if the ledger allows state snapshots (e.g., via `soroban ledger snapshot` or a separate backup service), restore the contract's storage to the pre-migration snapshot and re-apply the previous WASM. This is the only fully reversible path for storage mutations.

### Cross-references

- Contract module implementing the migration hook: `contracts/src/migrate.rs`
- ADRs covering custody and strategy changes: `docs/adr/` (see the relevant ADRs referenced in the issue)
- Event schema documentation: `docs/CONTRACT_EVENTS.md`apshot** if one was captured before the migration
   (not generally available on public networks).

> [!CAUTION]
> Always test the full upgrade-and-rollback cycle on testnet before executing
> on mainnet. Document whether the `migrate_storage` hook performs write
> mutations so operators can assess rollback risk.

#### Partial migration recovery

If `upgrade()` succeeds (new WASM is active) but the contract enters an
inconsistent state because `migrate_storage` failed partway through:

1. **Do not re-invoke `upgrade()`** — the WASM is already the target version.
2. Invoke `migrate_storage` again if it is idempotent (the implementation
   should document this).
3. If the hook is not idempotent, deploy a corrective WASM that includes a
   repair routine, or follow the storage-mutation rollback path above.

### Cross-references

| Document | Relevance |
|---|---|
| [`CONTRACT_EVENTS.md`](CONTRACT_EVENTS.md) | Event topic/payload shapes; bump `BACKEND_CONTRACT_EVENT_SCHEMA_VERSION` if shapes change. |
| [`CONTRACT_CAPABILITY_MATRIX.md`](CONTRACT_CAPABILITY_MATRIX.md) | Frontend capability detection and schema version alignment. |
| [`CONTRACT_DEPLOYMENT_CHECKLIST.md`](CONTRACT_DEPLOYMENT_CHECKLIST.md) | Full deployment and upgrade checklist for each environment. |
| [`DISASTER_RECOVERY.md`](DISASTER_RECOVERY.md) | Incident rollback and recovery procedures. |
| [`docs/adr/0002-reflector-oracle-selection.md`](adr/0002-reflector-oracle-selection.md) | Oracle selection decision governing strategy rebalance behaviour, price-feed dependencies, and fallback tiers. A schema migration that changes how the contract queries or caches oracle data must be evaluated against this ADR's fallback strategy. |
| `contracts/src/types.rs` | `DataKey` enum, `Portfolio` struct, `CONTRACT_VERSION`, `CONTRACT_EVENT_SCHEMA_VERSION`. |
| `contracts/src/lib.rs` | `upgrade()` entrypoint, `schema_version()` query. |

---

This project uses a **versioned migration framework** for PostgreSQL. Schema changes are applied deterministically and can be rolled back when needed.

## Quick reference

| Task | Command |
|------|--------|
| Apply pending migrations | `cd backend && npm run db:migrate` |
| Preview (dry-run) | `cd backend && npm run db:migrate -- --dry-run` |
| Roll back last migration | `cd backend && npm run db:migrate -- --rollback` |
| Roll back last N migrations | `cd backend && npm run db:migrate -- --rollback 2` |
| Show status | `cd backend && npm run db:migrate -- --status` |

Requires `DATABASE_URL` in the environment (e.g. in `.env` or CI).

---

## Backup and rollback

### Before running migrations

1. **Back up the database** (recommended for production):
   - **PostgreSQL:** `pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql`
   - Or use your provider’s snapshot/backup (e.g. RDS snapshot, Heroku pg:backups).

2. **Dry-run** to see what will run:
   ```bash
   npm run db:migrate -- --dry-run
   ```

3. Run migrations:
   ```bash
   npm run db:migrate
   ```

### If a migration fails

1. Fix the failure (e.g. fix SQL, fix data, or fix environment).
2. If you need to **undo the last migration**:
   ```bash
   npm run db:migrate -- --rollback
   ```
   This runs the corresponding `.down.sql` and removes the row from `schema_migrations`.

3. Restore from backup if you need to restore data:
   ```bash
   psql $DATABASE_URL < backup_YYYYMMDD_HHMMSS.sql
   ```

### Rollback by migration

Each migration has a **down** file (e.g. `001_initial_schema.down.sql`) that reverses the **up** migration. The runner applies down migrations in reverse order when you use `--rollback [n]`. Documented rollback behavior:

| Migration | Rollback (down) |
|-----------|------------------|
| `001_initial_schema` | Drops `notification_preferences`, `analytics_snapshots`, `rebalance_events`, `portfolios` (in that order). |
| `002_seed_demo_data` | Deletes demo portfolio `demo-portfolio-1` and its rebalance events. |

---

## Seed / demo data migration path

- **Optional migration:** `002_seed_demo_data` inserts a demo portfolio and sample rebalance events. It is **idempotent** (safe to run multiple times; uses `ON CONFLICT DO NOTHING`).
- **When to use:** Development, staging, or demo environments. You can **skip** this migration in production by not running it, or run it once for a demo instance.
- **To apply only schema (no demo data):** Ensure `002_seed_demo_data` is not applied (e.g. use a separate DB for prod and run only `001_initial_schema`, or roll back `002` after seeding a staging DB if you prefer).
- **SQLite (local):** The backend also supports SQLite via `DB_PATH`, but there is no standalone SQLite migration runner in this repo. `backend/src/services/databaseService.ts` creates the SQLite schema on startup and applies incremental SQLite-only schema adjustments in code.
- **SQLite runtime artifacts:** Files created under `backend/data/` such as `.db`, `.db-wal`, and `.db-shm` are machine-specific local state and are intentionally excluded from version control.
- **Tracked database sources only:** Keep SQL migration files, checked-in schema sources, and seed sources under version control. Do not commit generated SQLite database files.
- **For schema changes that affect both PostgreSQL and SQLite, update:**
  - `backend/src/db/migrations/` (PostgreSQL)
  - `backend/src/services/databaseService.ts` `SCHEMA_SQL` (SQLite)

---

## Version history and CI

- **Version history** is stored in the `schema_migrations` table (`version`, `name`, `applied_at`).
- **Migrations live in the repo** under `backend/src/db/migrations/` with naming:
  - `NNN_description.up.sql` – forward migration
  - `NNN_description.down.sql` – rollback for that version
- **Deterministic order:** Migrations run in ascending order of `NNN`. The same list of files produces the same order in every environment.
- **CI:** The backend workflow can run `npm run db:migrate -- --dry-run` to verify migration files and that the runner works. For full reproducibility, run real migrations in CI against a Postgres service container and then run tests (see workflow example below).

---

## Adding a new migration

1. Add two files in `backend/src/db/migrations/`:
   - `003_short_description.up.sql` – forward SQL
   - `003_short_description.down.sql` – rollback SQL
2. Use the next sequential number; do not renumber existing migrations.
3. Document rollback behavior in this file if it’s non-obvious.
4. Run `npm run db:migrate -- --dry-run` to confirm, then apply with `npm run db:migrate`.
