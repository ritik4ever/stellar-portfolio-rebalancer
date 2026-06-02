# Contributor Setup Guide

One path to a fully running local stack. Follow each section in order; services marked **optional** can be skipped if you are not working on that area.

---

## Prerequisites

| Tool         | Version | Notes                                                       |
| ------------ | ------- | ----------------------------------------------------------- |
| Node.js      | 18+     | Use [nvm](https://github.com/nvm-sh/nvm) to manage versions |
| npm          | 9+      | Comes with Node 18                                          |
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
npm run db:migrate          # apply all pending migrations
npm run db:migrate -- --status # show applied/pending migrations
npm run db:migrate -- --dry-run # preview without applying
```

To roll back the last migration:

```bash
npm run db:migrate -- --rollback
```

For local SQLite development, leave `DATABASE_URL` unset. You can optionally set `DB_PATH`; otherwise the backend uses `./data/portfolio.db` from inside `backend`.

```env
DB_PATH=./data/portfolio.db
```

Start the backend and `DatabaseService` will create the SQLite schema on first run. Runtime files under `backend/data/` such as `.db`, `.db-wal`, and `.db-shm` are local-only artifacts and are intentionally ignored by git.

If you want a fresh local SQLite database, stop the backend and delete `backend/data/portfolio.db`, `backend/data/portfolio.db-wal`, and `backend/data/portfolio.db-shm`. The next backend start recreates the database automatically.

Migration files live in `backend/src/db/migrations/`. Add new PostgreSQL migrations as `NNN_description.up.sql` / `.down.sql`. For SQLite schema changes, update `backend/src/services/databaseService.ts`.

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

## 13. Commit message conventions

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

This convention powers the automated changelog (`npm run changelog:update`) and keeps release history consistent.

### CI enforcement

Pull requests run a **Commit message lint** check (in the `Lint` workflow) that validates every commit in the PR against the format above. The check fails with a clear message listing any non-conforming commits.

Run the same check locally before opening a PR:

```bash
# Check the current branch against origin/main
scripts/check-commit-messages.sh

# Or check an explicit range
scripts/check-commit-messages.sh origin/main..HEAD
```

If the check flags a commit, amend or rebase to fix the subject line, e.g. `git commit --amend` for the latest commit or `git rebase -i origin/main` for earlier ones.

## 14. Optional local Git hooks

Install the optional hook templates when you want fast feedback before committing or pushing:

```bash
npm run hooks:install
```

This sets `core.hooksPath` to `scripts/hooks` for your local clone only.

The pre-commit hook runs:

- `npm run validate:env-examples`
- backend `npm run lint` when configured
- frontend `npm run lint` when configured
- root `npm run format` when configured

The pre-push hook runs:

- `npm run validate:env-examples`
- backend `npm run lint` when configured
- frontend `npm run lint` when configured
- frontend `npm test`
- backend `npm test`
- root `npm run format` when configured

Missing optional scripts are reported as skips. Any configured command that exits non-zero blocks the commit or push with the failing command visible in terminal output.

---

## 12. Pull Request Requirements

Every pull request must include **one** of the following in the PR description to pass the `pr-issue-trail` CI check. The check runs automatically whenever a PR is opened, edited, or updated.

### Accepted formats

**Option 1 — Link a GitHub issue**

Use a closing keyword followed by an issue number (shorthand or full URL):

```
Closes #42
Fixes #7
Resolves #1001
Refs #300
Related to #88

Fixes https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/42
```

Or place a bare reference anywhere in the description:

```
#42
https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/42
```

Accepted keywords (case-insensitive): `Closes`, `Fixes`, `Resolves`, `Refs`,
`References`, `Related to`.

**Option 2 — Declare no issue with a rationale**

If your PR intentionally has no backing issue (e.g. a typo fix, dependency bump, or CI tweak), start a line with `No issue:` followed by a one-sentence explanation:

```
No issue: dependency bump — no feature request needed
No issue: typo fix in README, trivial one-word change
```

Other accepted rationale keywords: `standalone`, `rationale:`, `reason:`, `intentionally no issue`.

---

### What the validator checks

1. **Comment stripping** — All `<!-- HTML comment -->` blocks are removed from the PR body before any matching occurs. Text that exists only inside comment markers (such as unfilled template placeholders) does not count.

2. **Path A** — The cleaned body is searched for an issue reference (keyword + `#NNN`, keyword + full URL, bare `#NNN`, bare full URL).

3. **Path B** — If Path A fails, the cleaned body is searched for a rationale keyword.

4. If neither path matches, the check exits with a failure and a prescriptive error message explaining exactly what to add.

---

### How to fix a failing check

You do **not** need to push a new commit. Simply:

1. Open the PR in the GitHub UI.
2. Click **Edit** on the PR description.
3. Add a valid issue reference or `No issue: <rationale>` — make sure it is **outside** any `<!-- comment -->` blocks.
4. Save. The `pr-issue-trail` check re-runs automatically within seconds.

---

### Automated PRs (Dependabot / Renovate)

Dependency manager bots are automatically skipped. The `pr-issue-trail`
workflow will not run — and will not fail — for PRs opened by
`dependabot[bot]` or `renovate[bot]`.

---

### Maintainer escape hatch

A maintainer can apply the **`skip-issue-check`** label to any PR to bypass
the check entirely. The label is evaluated on every run, so applying it after
a failure is enough — the check will pass on its next trigger without a code
change or re-run needed.

Only contributors with repository write access can apply labels, so this
cannot be self-granted by external contributors.

---

### Local testing

To reproduce the exact check locally before opening a PR:

```bash
# Write your draft PR description to a file
echo "Closes #42" > /tmp/test_pr_body.txt

# Run the validator (no labels file = no escape hatch)
bash scripts/check-pr-body.sh /tmp/test_pr_body.txt

# Exit code 0 = would pass CI; exit code 1 = would fail CI
echo "Exit code: $?"
```

---

## Further reading

- [Maintainer Triage Guide](TRIAGE.md) — Issue and PR triage procedures for maintainers
- [Operations handbook](OPERATIONS.md) — Redis, workers, indexer, health vs readiness, restarts
- [OpenAPI source of truth and export workflow](../backend/docs/openapi.md)
- [API reference](API.md)
- [Database migrations](MIGRATION.md)
- [Notification system](NOTIFICATIONS.md)
- [Rebalancing strategies](REBALANCING_STRATEGIES.md)
- [Demo Walkthrough](DEMO_WALKTHROUGH.md) — Visual guide to platform features

### Architecture and Design

- [Frontend state and data flow](FRONTEND_STATE_FLOW.md) — Query ownership, cache boundaries, mutation patterns
- [Queue worker lifecycle](QUEUE_WORKER_LIFECYCLE.md) — Job states, retry policy, worker deployment
- [Contract deployment checklist](CONTRACT_DEPLOYMENT_CHECKLIST.md) — Environment-specific steps for local, testnet, staging, production
- [Privacy and consent alignment](PRIVACY_CONSENT_ALIGNMENT.md) — Legal wording, consent flow, GDPR compliance

### Legal content version

Legal copy is versioned in `frontend/src/content/legalMetadata.ts` (`LEGAL_BUNDLE_VERSION`, `LEGAL_EFFECTIVE_DATE`). The same label is shown on legal pages and in the consent modal. When you change Terms, Privacy, or Cookie text in `frontend/src/components/Legal.tsx`, bump both constants and note the change in your PR so users and auditors can match UI text to a specific release.
