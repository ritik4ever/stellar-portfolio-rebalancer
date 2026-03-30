# Contributor Setup Guide

One path to a fully running local stack. Follow each section in order; services marked **optional** can be skipped if you are not working on that area.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 18+ | Use [nvm](https://github.com/nvm-sh/nvm) to manage versions |
| npm | 9+ | Comes with Node 18 |
| PostgreSQL | 14+ | Optional — SQLite fallback works for most dev work |
| Redis | 6+ | Optional — queue workers are skipped when unavailable |
| Rust + Cargo | stable | Only needed for contract development |
| Soroban CLI | latest | Only needed for contract deployment |

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

## 3. Database migrations

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

## 4. Redis and queue workers (optional)

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

## 5. Auth environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | Required for auth (≥32 chars) | Signs access and refresh tokens — never falls back to a built-in value |
| `JWT_ACCESS_EXPIRY_SEC` | No (default: 900) | Access token TTL in seconds |
| `JWT_REFRESH_EXPIRY_SEC` | No (default: 604800) | Refresh token TTL in seconds |
| `ADMIN_PUBLIC_KEYS` | Yes for admin routes | Comma-separated Stellar public keys |

**Rules enforced at startup:**
- If `JWT_SECRET` is **absent** — auth is disabled, `/api/auth/*` routes return `503`, and the server starts normally.
- If `JWT_SECRET` is **set but shorter than 32 characters** — the server refuses to start with a clear error.
- The backend **never** falls back to a built-in/default secret; tokens are always signed with your explicitly configured value.

To generate a strong secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 6. Notification environment variables (optional)

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

Test that notifications are wired up:

```bash
curl -X POST http://localhost:3001/api/v1/notifications/test \
  -H "Content-Type: application/json" \
  -d '{"userId": "YOUR_STELLAR_ADDRESS", "eventType": "rebalance"}'
```

---

## 7. Start development servers

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

## 8. Running tests

### Backend unit + integration tests

```bash
cd backend
npm test              # run all tests
npm test -- --watch   # watch mode
```

Tests use an isolated SQLite database per run (no external dependencies required).

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

---

## 9. Contract and indexer setup (optional)

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

---

## 10. Common setup failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| `JWT auth not configured (set JWT_SECRET)` | `JWT_SECRET` missing or < 32 chars | Set a valid secret in `.env` |
| `Admin auth not configured` | `ADMIN_PUBLIC_KEYS` empty | Add your Stellar public key |
| `503 Service Unavailable` on queue endpoints | Redis not running | Start Redis or set `REDIS_URL` |
| `ECONNREFUSED` on DB queries | PostgreSQL not running | Start Postgres or remove `DATABASE_URL` to use SQLite |
| Playwright `net::ERR_CONNECTION_REFUSED` | Dev servers not started | Start backend and frontend before running E2E |
| `Cannot find module` TypeScript errors | Dependencies not installed | Run `npm install` in backend/ and frontend/ |
| Stellar horizon errors on contract calls | Wrong network | Check `STELLAR_NETWORK` and `STELLAR_HORIZON_URL` match |

---

## Further reading

- [Operations handbook](OPERATIONS.md) — Redis, workers, indexer, health vs readiness, restarts
- [OpenAPI source of truth and export workflow](../backend/docs/openapi.md)
- [API reference](API.md)
- [Database migrations](MIGRATION.md)
- [Notification system](NOTIFICATIONS.md)
- [Rebalancing strategies](REBALANCING_STRATEGIES.md)
