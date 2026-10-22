# SQLite Development Setup (Clean Checkout)

SPR-2026-261 makes the local SQLite setup reproducible from a clean clone and
gives it a single, actionable failure mode.

A fresh checkout has **no `backend/data/` directory and no prebuilt database**.
That is intentional: runtime database files are local state, are ignored by git,
and are recreated on first start. This document describes the contract, how to
check it, and what to do when it fails.

## Quick check

```bash
cd backend
npm run db:validate:dev
```

The validator uses a throwaway directory under the OS temp directory, so it does
not touch your working database. It exits `0` only when every check passes:

| Check | What it proves |
| --- | --- |
| `default DB_PATH resolution` | Unset/blank `DB_PATH` resolves to `./data/portfolio.db` |
| `clean checkout has no prebuilt database` | The run starts from nothing |
| `first start creates directory, database and schema` | `DatabaseService` bootstraps all required tables |
| `second start is repeatable and does not duplicate seed data` | Re-running does not fail or double-seed |
| `shared SQLite consumers initialise on the clean path` | Notifications, idempotency and export schedules work without `DatabaseService` having run first |
| `unusable path returns an actionable setup error` | Broken paths produce a named error + next step, not a raw driver message |

Options:

```bash
npm run db:validate:dev -- --keep          # keep the throwaway directory for inspection
npm run db:validate:dev -- ./tmp/sqlite-check   # use a specific clean directory
```

## Normal local start

```bash
cd backend
# Leave DATABASE_URL unset to use SQLite.
DB_PATH=./data/portfolio.db npm run dev
```

- `DB_PATH` is optional; the default is `./data/portfolio.db` relative to
  `backend`.
- `DB_PATH` may be a nested path. The parent directory is created on first use.
- `DB_PATH=:memory:` is supported for tests and short-lived processes.
- No database file needs to be checked in or copied. Do not commit `.db`,
  `.db-wal` or `.db-shm` files.

### What creates what

| Consumer | Module | Tables |
| --- | --- | --- |
| Main application data | `services/databaseService.ts` | portfolios, assets, rebalance history, preferences, … |
| Notification preferences and logs | `db/notificationDb.ts` | notification_preferences, notification_logs, … |
| Idempotency keys | `db/idempotencyDb.ts` | idempotency_keys |
| Export schedules | `db/exportScheduleDb.ts` | export_schedules |

All four now open their database through `db/sqliteBootstrap.ts`. Before
SPR-2026-261 only `DatabaseService` created the parent directory, so a clean
checkout could fail with `unable to open database file` the first time a
notification or idempotency lookup ran before the main service booted (for
example in scripts or focused tests).

## Resetting local state

Stop the backend, then:

```bash
rm -f data/portfolio.db data/portfolio.db-wal data/portfolio.db-shm
```

The next start recreates the directory, schema and default assets. This is the
documented recovery path for a corrupt local database — no other state is
involved.

## Failure messages

`SqliteSetupError` always includes the resolved path and a concrete next step:

| Message contains | Cause | Fix |
| --- | --- | --- |
| `parent "…" exists but is not a directory` | A file is occupying the directory the database needs | Move the file aside or change `DB_PATH` |
| `Cannot create "…"` | Permission denied, read-only mount, volume owned by another user | Point `DB_PATH` at a writable directory |
| `file or its directory … is not writable` | SQLite cannot open/create the file | Fix permissions or change `DB_PATH` |
| `native better-sqlite3 binding is missing` | `npm ci --ignore-scripts` without a rebuild, or a Node version change | `npm rebuild better-sqlite3` (CI uses `npm ci --ignore-scripts && npm rebuild better-sqlite3`) |
| `file is not a usable database` | Truncated/corrupt local file | Follow [Resetting local state](#resetting-local-state) or restore a backup |

## CI

`Backend Tests` runs the validator in the `sqlite-dev-setup` job on every
backend change, and fails if a `.db`, `.db-wal` or `.db-shm` file is tracked in
`backend/data/`. That keeps the "clean checkout" promise from regressing to a
state that only works on the machine where the database was created.

## Tests

- `src/test/sqliteDevSetup.test.ts` covers path resolution, directory creation,
  clear setup errors, repeatable opens, the shared consumers on a clean path,
  two consecutive `DatabaseService` boots and the validator report.
- `scripts/validate-sqlite-dev-setup.ts` is the same code CI runs, so the
  documented command and the gate cannot drift.
