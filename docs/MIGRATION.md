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
