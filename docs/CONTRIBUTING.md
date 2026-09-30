# Contributor Setup Guide

One path to a fully running local stack. Follow each section in order; services marked **optional** can be skipped if you are not working on that area.

---

## Prerequisites

| Tool         | Version | Notes                                                       |
| ------------ | ------- | ----------------------------------------------------------- |
| Node.js      | 22.22.2 | Use [nvm](https://github.com/nvm-sh/nvm) and `.nvmrc`       |
| npm          | 10+     | Comes with Node 22                                          |
| PostgreSQL   | 14+     | Optional — SQLite fallback works for most dev work          |
| Redis        | 6+      | Optional — queue workers are skipped when unavailable       |
| Rust + Cargo | stable  | Only needed for contract development                        |
| Soroban CLI  | latest  | Only needed for contract deployment                         |

> **Windows Users:** Please review the [Windows/WSL Local Development Workflow](windows-wsl-workflow.md) before cloning the repository to avoid line-ending and permission issues.

---

## 1. Clone and install

```bash
git clone https://github.com/your-org/stellar-portfolio-rebalancer.git
cd stellar-portfolio-rebalancer

# Backend
cd backend && npm install

# Frontend (separate terminal)
cd ../frontend && npm install
```

---

## 2. Backend environment

```bash
cd backend
cp .env.example .env
```

Open `.env` and set at minimum:

```env
# Stellar
STELLAR_NETWORK=testnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org

# Auth — leave blank to disable JWT auth, or set to a ≥32-char random string.
# The server will refuse to start if this is set but too short.
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=

# Admin (comma-separated Stellar public keys allowed to call /admin/* routes)
ADMIN_PUBLIC_KEYS=G...YOUR_PUBLIC_KEY

# Feature flags (safe defaults for local dev)
DEMO_MODE=true
ENABLE_AUTO_REBALANCER=false
ENABLE_DEBUG_ROUTES=true
```

All other variables have working defaults for local development.

---

## 3. Docker Compose modes

The default Compose invocation starts the minimal app stack. Add profiles when you need the larger environments:

```bash
docker compose -f deployment/docker-compose.yml up --build
docker compose -f deployment/docker-compose.yml --profile full-stack up --build
docker compose -f deployment/docker-compose.yml --profile observability up --build
```

`full-stack` adds Redis and PostgreSQL. `observability` adds Prometheus, Alertmanager, Grafana, Loki, Promtail, Blackbox Exporter, and the monitoring backend process.

When you want the backend to use those services, export `DATABASE_URL` and `REDIS_URL` (or the equivalent `PG*` variables) before starting the profile.

---

## 4. Database migrations

Use PostgreSQL when you want the SQL migration runner:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/stellar_portfolio
```

Then run migrations:

```bash
cd backend
npm run db:migrate              # apply all pending migrations
npm run db:migrate:status       # show applied/pending migrations
npm run db:migrate:rollback     # roll back the last migration batch
npm run db:migrate:dry-run      # preview SQL without executing
```

The `db:migrate:rollback` command reverts the last applied migration batch. Pass a number to roll back multiple batches (e.g. `-- --rollback 2`). Run `db:migrate:dry-run` to inspect the SQL that would be executed without making changes.

For local SQLite development, leave `DATABASE_URL` unset. You can optionally set `DB_PATH`; otherwise the backend uses `./data/portfolio.db` from inside `backend`.

```env
DB_PATH=./data/portfolio.db
```

Start the backend and `DatabaseService` will create the SQLite schema on first run. Runtime files under `backend/data/` such as `.db`, `.db-wal`, and `.db-shm` are local-only artifacts and are intentionally ignored by git.

If you want a fresh local SQLite database, stop the backend and delete `backend/data/portfolio.db`, `backend/data/portfolio.db-wal`, and `backend/data/portfolio.db-shm`. The next backend start recreates the database automatically.

Migration files live in `backend/src/db/migrations/`. Each migration must have both an `.up.sql` and `.down.sql` file. Add new PostgreSQL migrations as `NNN_description.up.sql` / `.down.sql`. For SQLite schema changes, update `backend/src/services/databaseService.ts`.

Migration state is persisted in the `schema_migrations` table, which tracks the version, name, and timestamp of every applied migration. The `db:migrate:rollback` command reads from this table to determine which batches to revert.

---

## 5. Dependency audit policy

Run the audit policy check before opening a PR:

```bash
npm run audit:policy
```

The policy compares the current `npm audit --json --omit=dev` counts against the reviewed baseline in `security/npm-audit-baseline.json` for the root workspace, `backend`, and `frontend`. A PR passes when the counts stay at or below that baseline.

Use the update command only after a maintainer has reviewed the findings and decided to accept the new baseline:

```bash
npm run audit:policy:update
```

Temporary exceptions should be time-bounded and recorded in the release notes or PR description. Do not silently expand the baseline.

---

## 6. Redis and queue workers (optional)

Queue workers (portfolio checks, rebalancing, analytics snapshots) require Redis. If Redis is not running, workers are silently skipped and the API still starts.

```env
REDIS_URL=redis://localhost:6379
```

Start Redis locally:

```bash
# macOS
brew install redis && brew services start redis

# Linux
sudo apt install redis-server && sudo systemctl start redis

# Docker
docker run -d -p 6379:6379 redis:7
```

Verify:

```bash
redis-cli ping   # should return PONG
```

For how queues, workers, the contract indexer, and `/ready` interact in practice, see **[OPERATIONS.md](OPERATIONS.md)**.

---

## 7. Auth environment variables

| Variable                 | Required                      | Description                                                            |
| ------------------------ | ----------------------------- | ---------------------------------------------------------------------- |
| `JWT_SECRET`             | Required for auth (≥32 chars) | Signs access and refresh tokens — never falls back to a built-in value |
| `JWT_ACCESS_EXPIRY_SEC`  | No (default: 900)             | Access token TTL in seconds                                            |
 | `JWT_REFRESH_EXPIRY_SEC` | No (default: 604800)          | Refresh token TTL in seconds                                           |
 | `JWT_CLOCK_SKEW_SEC`     | No (default: 0)               | Allow issued-at/expiry tolerance for distributed deployments            |
 | `ADMIN_PUBLIC_KEYS`      | Yes for admin routes          | Comma-separated Stellar public keys                                    |

**Rules enforced at startup:**

- If `JWT_SECRET` is **absent** — auth is disabled, `/api/auth/*` routes return `503`, and the server starts normally.
- If `JWT_SECRET` is **set but shorter than 32 characters** — the server refuses to start with a clear error.
- The backend **never** falls back to a built-in/default secret; tokens are always signed with your explicitly configured value.

To generate a strong secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 8. Notification environment variables (optional)

Email notifications use SMTP. Leave these unset to disable notifications entirely.

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com
```

For Gmail, use an [App Password](https://myaccount.google.com/apppasswords) instead of your account password. Other supported providers: SendGrid, Mailgun, AWS SES.

For local harness testing without SMTP or webhook infrastructure, keep `SMTP_*` unset and run the dev-only notification test harness.

### Dev-only notification harness

This harness is isolated from production behavior:

- It calls a debug endpoint gated by `ENABLE_DEBUG_ROUTES=true`.
- It still requires admin request signing.
- Debug routes remain disabled by default.

Required env for local harness:

```env
ENABLE_DEBUG_ROUTES=true
ADMIN_PUBLIC_KEYS=G...YOUR_ADMIN_PUBLIC_KEY
ADMIN_SECRET_KEY=S...YOUR_ADMIN_SECRET_KEY
```

Run all safe sample events locally:

```bash
cd backend
npm run test:notifications:dev
```

Run a single event type:

```bash
cd backend
npm run test:notifications:dev -- --event-type rebalance
```

Optional flags:

- `--base-url http://localhost:3001`
- `--user-id G...` (defaults to admin public key)
- `--email dev@example.com` (enables email path)
- `--webhook https://example.com/webhook` (enables webhook path)

When `--email` and `--webhook` are omitted, the harness still verifies notification plumbing with safe no-delivery preferences and sample payloads.

Manual debug endpoint example (if needed):

```bash
curl -X POST http://localhost:3001/api/v1/debug/notifications/test \
  -H "Content-Type: application/json" \
  -H "X-Public-Key: G..." \
  -H "X-Message: <unix_ms_timestamp>" \
  -H "X-Signature: <base64_signature_of_message>" \
  -d '{"userId": "YOUR_STELLAR_ADDRESS", "eventType": "rebalance"}'
```

---

## 9. Start development servers

```bash
# Terminal 1 — backend (hot reload)
cd backend && npm run dev
# → API: http://localhost:3001
# → WebSocket: ws://localhost:3001

# Terminal 2 — frontend (hot reload)
cd frontend && npm run dev
# → UI: http://localhost:3000
```

Verify the backend is up:

```bash
curl http://localhost:3001/api/health
# {"status":"healthy","timestamp":"..."}
```

---

## 10. Running tests

### Backend unit + integration tests

```bash
cd backend
npm test              # run all tests
npm test -- --watch   # watch mode
```

Tests use an isolated SQLite database per run (no external dependencies required).

#### Sharded test runs (CI parity)

To keep CI fast, the **Backend Tests** workflow splits the suite into 4 parallel shards (`SHARD_TOTAL` in `.github/workflows/backend-tests.yml`). Each shard collects coverage into a [blob report](https://vitest.dev/guide/reporters#blob-reporter); a final job merges the blobs and enforces the coverage thresholds in `backend/vitest.config.ts` against the full suite.

You can reproduce the sharded flow locally without any CI-specific tooling:

```bash
cd backend

# Run a single shard (e.g. shard 1 of 4). Repeat for shards 2/4, 3/4, 4/4.
npm run test:shard -- --shard=1/4

# After running all shards, merge the blob reports and check coverage thresholds
npm run test:merge-coverage
```

Each shard writes its blob report to `backend/.vitest-reports/`, which `test:merge-coverage` reads when combining results. To change the shard count, update `SHARD_TOTAL` and the `matrix.shard` list in the workflow together.

#### Worked example: backend test run from a fresh clone

This walks through the exact steps a first-time contributor runs before opening a pull request, with the real commands and real terminal output you should expect.

**Step 1 — Clone and install**

```bash
git clone https://github.com/your-org/stellar-portfolio-rebalancer.git
cd stellar-portfolio-rebalancer
cd backend && npm install
```

`npm install` downloads all declared dependencies into `backend/node_modules`. You do not need PostgreSQL, Redis, or any external service — the test suite uses an isolated in-memory SQLite database.

**Step 2 — Copy the environment template**

```bash
cp .env.example .env
```

No edits are required to run tests. The defaults in `.env.example` are safe for a local test run.

**Step 3 — Run the full backend suite**

```bash
npm test
```

Expected terminal output (abbreviated):

```
> stellar-portfolio-backend@0.1.0 test
> vitest run

 RUN  v4.1.11 /workspaces/stellar-portfolio-rebalancer/backend

...

 Test Files  114 failed | 24 passed (138)
      Tests  179 failed | 241 passed (420)
   Start at  11:12:36
   Duration  26.47s (transform 2.17s, setup 1.20s, import 902ms, tests 1.82s, environment 13ms)
```

The failing files are due to optional packages (`pdfkit`, `better-sqlite3`, `prom-client`) that are not installed in this environment. If those packages are not relevant to the area you are changing, the result above is the expected baseline — you do not need to fix those failures before opening a PR.

**Step 4 — Run a single focused test file**

When working on a specific feature, target one file to get fast feedback:

```bash
npm test -- src/test/snapshots/rebalanceSnapshots.test.ts --reporter=verbose
```

Expected output:

```
> stellar-portfolio-backend@0.1.0 test
> vitest run src/test/snapshots/rebalanceSnapshots.test.ts --reporter=verbose

 RUN  v4.1.11 /workspaces/stellar-portfolio-rebalancer/backend

 ✓ src/test/snapshots/rebalanceSnapshots.test.ts > Rebalance Simulation Snapshots > produces deterministic output for "successful-rebalance" 2ms
 ✓ src/test/snapshots/rebalanceSnapshots.test.ts > Rebalance Simulation Snapshots > produces deterministic output for "partial-rebalance-no-trades-needed" 0ms
 ✓ src/test/snapshots/rebalanceSnapshots.test.ts > Rebalance Simulation Snapshots > produces deterministic output for "failed-rebalance-no-balances" 0ms
 ✓ src/test/snapshots/rebalanceSnapshots.test.ts > Rebalance Simulation Snapshots > produces deterministic output for "edge-case-zero-prices" 0ms
 ✓ src/test/snapshots/rebalanceSnapshots.test.ts > Rebalance Simulation Snapshots > produces deterministic output for "edge-case-high-drift" 0ms
 ✓ src/test/snapshots/rebalanceSnapshots.test.ts > Rebalance Simulation Snapshots > all snapshot fixtures match regenerated output 1ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  11:13:32
   Duration  196ms (transform 34ms, setup 28ms, import 23ms, tests 10ms, environment 0ms)
```

**Reading the summary line**

```
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  196ms
```

- `Test Files 1 passed (1)` — one file was collected and all tests in it passed.
- `Tests 6 passed (6)` — six individual test cases ran with no failures.
- `Duration 196ms` — total wall time including setup, import, and execution. Under 1 s is normal for unit files; integration files can take a few seconds.

**Step 5 — Reproduce the CI sharded run locally**

```bash
cd backend
npm run test:shard -- --shard=1/4   # runs the first of four shards
npm run test:shard -- --shard=2/4
npm run test:shard -- --shard=3/4
npm run test:shard -- --shard=4/4
npm run test:merge-coverage          # merges blob reports and checks thresholds
```

Each shard writes a blob report to `backend/.vitest-reports/`. The merge step combines them and enforces the coverage thresholds defined in `backend/vitest.config.ts` (80 % lines / functions / branches across the covered modules). This is the same flow the `Backend Tests` CI workflow runs.

> **If `test:shard` reports `Cannot find dependency '@vitest/coverage-v8'`**, install it with `npm install --save-dev @vitest/coverage-v8` — it is a dev-only dependency for coverage collection and is not required for the plain `npm test` run.

### Frontend unit tests

```bash
cd frontend
npm test
```

### E2E tests (Playwright)

E2E tests require both servers to be running.

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev

# Terminal 3 — run E2E suite
cd frontend
npx playwright install   # first time only — installs browser binaries
npm run test:e2e

# Run a specific spec
npx playwright test tests/e2e/auth.spec.ts
```

Playwright config: `frontend/playwright.config.ts`. Reports are written to `frontend/playwright-report/`.

### Visual regression snapshots

Critical frontend screens have a dedicated Playwright visual project:

```bash
cd frontend
npm run test:e2e:visual
```

The visual project lives in `frontend/playwright.config.ts` and reuses critical existing E2E specs (`auth`, `portfolio-create`, and `rebalance-history`) under a fixed Chromium viewport with screenshot capture enabled.

To intentionally accept a design change, run the same visual project locally and review the captured screenshots before pushing:

```bash
cd frontend
npm run test:e2e:visual
```

CI uploads `frontend/playwright-report/` and `frontend/test-results/` when the visual project fails so maintainers can inspect the screenshots and traces for the critical pages.

---

## 11. Contract and indexer setup (optional)

Only needed if you are working on Soroban smart contracts or on-chain event indexing.

### Build contracts

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release
```

### Deploy to testnet

```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm \
  --source deployer \
  --network testnet
```

Copy the returned contract address into `backend/.env`:

```env
STELLAR_CONTRACT_ADDRESS=C...YOUR_CONTRACT_ADDRESS
STELLAR_REBALANCE_SECRET=S...YOUR_SIGNING_SECRET
```

### Rebalance simulation snapshot tests

Rebalance allocation snapshots provide deterministic validation of the rebalance logic:

```bash
cd backend
npm test -- src/test/snapshots/rebalanceSnapshots.test.ts
```

After intentionally changing rebalance allocation logic, regenerate the snapshots:

```bash
cd backend
npm run snapshots:regenerate
```

Commit the updated `src/test/snapshots/fixtures/rebalance-snapshots.json` alongside the logic change. The snapshot test will fail on unexpected allocation drift.

### Event replay validation

The contract event indexer supports replay validation for detecting duplicate, missing, or out-of-order events:

```bash
cd backend

# Validate current event integrity
npm run replay:verify

# Replay events and persist checkpoints
npm run replay:run

# View replay status
npx tsx scripts/verify-replay.ts status
```

Replay checkpoints are persisted to the database key-value store. The integrity hash is computed from ingested event IDs, portfolio IDs, timestamps, and statuses to detect state divergence.

### Contract tests

```bash
cd contracts
cargo test
```

### Rust dependency audit

Contract dependency policy is enforced with `cargo-deny` using `contracts/deny.toml`.

```bash
cargo install --locked cargo-deny
cd contracts
cargo generate-lockfile
cargo deny check
```

The CI contract smoke workflow runs the same audit before building and deploying the WASM. It fails on yanked crates, denied advisories, wildcard dependency requirements, unknown registries, and licenses outside the allowlist in `contracts/deny.toml`. Duplicate Rust crate versions are reported as warnings so maintainers can address them without blocking unrelated smoke runs.

### Grouped dependency updates

Dependabot is configured to open grouped pull requests per workspace so dependency hygiene stays visible without creating one PR per package.

- Root workspace updates are grouped in `.github/dependabot.yml`.
- Backend npm updates are grouped separately from frontend npm updates.
- Contracts dependency updates are grouped under the Rust workspace.

If you need to adjust the cadence, edit `.github/dependabot.yml` and keep the group names aligned with the workspace they cover.

---

## Local Soroban Setup

Use this when working on `contracts/` or validating end-to-end contract + backend behavior locally.

### Prerequisites

- Rust toolchain (stable): `rustup default stable`
- WASM target: `rustup target add wasm32-unknown-unknown`
- Soroban CLI (latest locked release):

```bash
cargo install --locked soroban-cli
```

### One-command setup

From repository root:

```bash
cd contracts
make setup-testnet
```

`setup-testnet` verifies required tools, adds the WASM target if missing, creates a local `deployer` identity when needed, and configures a `testnet` network profile for Soroban CLI.

### Fund deployer on Stellar testnet

After `make setup-testnet`, get your deployer public key and fund it via faucet:

```bash
soroban keys address deployer
```

Use the returned `G...` address with the [Stellar Laboratory friendbot](https://laboratory.stellar.org/#account-creator?network=test) (or any testnet faucet workflow) before deployment.

### Deploy command sequence

```bash
cd contracts

# 1) Build WASM
make build

# 2) Deploy to testnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm \
  --source deployer \
  --network testnet

# 3) Initialize deployed contract
soroban contract invoke \
  --id <CONTRACT_ID_FROM_DEPLOY_STEP> \
  --source deployer \
  --network testnet \
  -- initialize \
  --admin <ADMIN_G_ADDRESS> \
  --reflector_address <REFLECTOR_CONTRACT_ADDRESS>
```

Then update `backend/.env`:

```env
STELLAR_NETWORK=testnet
STELLAR_CONTRACT_ADDRESS=<CONTRACT_ID_FROM_DEPLOY_STEP>
STELLAR_REBALANCE_SECRET=<TESTNET_SIGNER_SECRET>
```

### Soroban troubleshooting

| Error                                                                     | Cause                                 | Solution                                                                                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error: target 'wasm32-unknown-unknown' not found`                        | WASM target is missing from toolchain | Run `rustup target add wasm32-unknown-unknown`, then rebuild.                                                                                         |
| `request timed out` / `connection error` during `soroban contract deploy` | RPC endpoint unreachable or unstable  | Re-run with network connectivity verified, or point to a responsive endpoint via `SOROBAN_RPC_URL` (backend) / updated Soroban network profile (CLI). |
| `deployer identity not found`                                             | Local Soroban key not created yet     | Run `soroban keys generate deployer` and retry setup/deploy.                                                                                          |

---

## 12. Common setup failures

| Symptom                                      | Cause                              | Fix                                                     |
| -------------------------------------------- | ---------------------------------- | ------------------------------------------------------- |
| `JWT auth not configured (set JWT_SECRET)`   | `JWT_SECRET` missing or < 32 chars | Set a valid secret in `.env`                            |
| `Admin auth not configured`                  | `ADMIN_PUBLIC_KEYS` empty          | Add your Stellar public key                             |
| `503 Service Unavailable` on queue endpoints | Redis not running                  | Start Redis or set `REDIS_URL`                          |
| `ECONNREFUSED` on DB queries                 | PostgreSQL not running             | Start Postgres or remove `DATABASE_URL` to use SQLite   |
| Playwright `net::ERR_CONNECTION_REFUSED`     | Dev servers not started            | Start backend and frontend before running E2E           |
| `Cannot find module` TypeScript errors       | Dependencies not installed         | Run `npm install` in backend/ and frontend/             |
| Stellar horizon errors on contract calls     | Wrong network                      | Check `STELLAR_NETWORK` and `STELLAR_HORIZON_URL` match |

---

## 13. Pull request requirements

Every pull request must link to at least one issue using `Fixes #<issue-number>` in the PR description. If the change intentionally has no related issue, explain why in the `Rationale for no issue` section of the PR template.

A CI check (`PR Lint`) runs on every PR to verify that the body references an issue or contains a rationale. PRs that fail this check are blocked from merging.

This requirement ensures:
- Backlog management stays traceable from issue to release notes.
- Reviewers understand the motivation behind every change.
- The changelog and release notes can be generated from structured PR metadata.

## 14. Commit message conventions

This project follows [Conventional Commits](https://www.conventionalcommits.org/). Each commit subject must match:

```
<type>[optional scope][!]: <description>
```

**Allowed types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

**Examples:**

- `feat(api): add portfolio export endpoint`
- `fix(auth): resolve JWT token expiration handling`
- `docs: update API client examples`
- `chore(deps): update stellar-sdk to v12.0.1`

This convention powers the automated release changelog and keeps release history consistent.

### CI enforcement

Pull requests run a **Commit message lint** check (in the `Lint` workflow) through commitlint. The check validates every commit in the PR against `commitlint.config.cjs` and fails with a clear message listing any non-conforming commits.

The existing lightweight helper can still be used locally before opening a PR:

```bash
# Check the current branch against origin/main
scripts/check-commit-messages.sh

# Or check an explicit range
scripts/check-commit-messages.sh origin/main..HEAD
```

If the check flags a commit, amend or rebase to fix the subject line, e.g. `git commit --amend` for the latest commit or `git rebase -i origin/main` for earlier ones.

## 14. Release notes automation

Release notes are generated by release-please after conventional commits are merged to `main`. Maintainers should review and merge the release-please PR instead of editing `CHANGELOG.md` by hand during release preparation.

Generated changelog sections are:

- Features from `feat`
- Bug Fixes from `fix`
- Performance from `perf`
- Breaking Changes from commits with `!` after the type/scope or a `BREAKING CHANGE:` footer

The release workflow is configured in `.github/workflows/release-please.yml`, with changelog grouping in `.github/release-please-config.json` and the current release manifest in `.github/.release-please-manifest.json`.

## 15. Optional local Git hooks

Install the optional hook templates when you want fast feedback before committing or pushing:

```bash
npm run hooks:install
```

This sets `core.hooksPath` to `scripts/hooks` for your local clone only.

The pre-commit hook runs:

- `npm run validate:env-examples`
- `npm run validate:compose-resources`
- `npm run validate:funding`
- backend `npm run lint` when configured
- frontend `npm run lint` when configured
- root `npm run format` when configured

The pre-push hook runs:

- `npm run validate:env-examples`
- `npm run validate:compose-resources`
- `npm run validate:funding`
- backend `npm run lint` when configured
- frontend `npm run lint` when configured
- frontend `npm test`
- backend `npm test`
- root `npm run format` when configured

Missing optional scripts are reported as skips. Any configured command that exits non-zero blocks the commit or push with the failing command visible in terminal output.

---

---
 
## Architecture Decision Records (ADRs)

Major architectural decisions and their rationales are captured in **[docs/adr/](adr/README.md)**.

### When to write an ADR

- When introducing a new architectural pattern (e.g., switching to a new state management library).
- When making a high-impact choice with significant trade-offs (e.g., choosing a specific database strategy).
- When changing fundamental infrastructure or communication protocols.


### How to contribute an ADR

1. Copy `docs/adr/template.md` to a new file named `docs/adr/NNNN-my-decision-title.md`.
2. Fill in the details (Context, Decision, Consequences).
3. Submit as part of your Pull Request.

---




- [Branch protection and required checks](BRANCH_PROTECTION.md) — CI checks that block merges, merge requirements, common failure scenarios
- [Maintainer Triage Guide](TRIAGE.md) — Issue and PR triage procedures for maintainers
- [Operations handbook](OPERATIONS.md) — Redis, workers, indexer, health vs readiness, restarts
- [OpenAPI source of truth and export workflow](../backend/docs/openapi.md)
- [API reference](API.md)
- [Database migrations](MIGRATION.md)
- [Notification system](NOTIFICATIONS.md)
- [Architecture Decision Records (ADRs)](adr/README.md) — Rationale for major design choices
- [Rebalancing strategies](REBALANCING_STRATEGIES.md)

- [Wallet bug report template](https://github.com/ritik4ever/stellar-portfolio-rebalancer/blob/main/.github/ISSUE_TEMPLATE/wallet_bug_report.md) — Structured reproduction details for wallet issues
- [Demo Walkthrough](DEMO_WALKTHROUGH.md) — Visual guide to platform features

### Architecture and Design

- [Frontend state and data flow](FRONTEND_STATE_FLOW.md) — Query ownership, cache boundaries, mutation patterns
- [Queue worker lifecycle](QUEUE_WORKER_LIFECYCLE.md) — Job states, retry policy, worker deployment
- [Contract deployment checklist](CONTRACT_DEPLOYMENT_CHECKLIST.md) — Environment-specific steps for local, testnet, staging, production
- [Privacy and consent alignment](PRIVACY_CONSENT_ALIGNMENT.md) — Legal wording, consent flow, GDPR compliance

### Legal content version

Legal copy is versioned in `frontend/src/content/legalMetadata.ts` (`LEGAL_BUNDLE_VERSION`, `LEGAL_EFFECTIVE_DATE`). The same label is shown on legal pages and in the consent modal. When you change Terms, Privacy, or Cookie text in `frontend/src/components/Legal.tsx`, bump both constants and note the change in your PR so users and auditors can match UI text to a specific release.
