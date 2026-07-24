# Environment Variable Reference

Canonical reference for `backend/.env.example` and `frontend/.env.example`.
Variables marked **⚠️ SECRET** must never be committed, logged, or exposed in client bundles.

## Contents

- [Quick Start](#quick-start)
- [Secret Rotation Guide](#secret-rotation-guide)
- [Backend Variables](#backend-variables)
  - [Core](#core)
  - [Database](#database)
  - [Stellar & Soroban](#stellar--soroban)
  - [Price Feed](#price-feed)
  - [Auto-Rebalancer](#auto-rebalancer)
  - [API Rate Limiting](#api-rate-limiting)
  - [Redis](#redis)
  - [Risk Controls](#risk-controls)
  - [Security & Auth](#security--auth)
  - [Notifications](#notifications)
  - [Observability](#observability)
  - [Analytics & Snapshots](#analytics--snapshots)
  - [Demo Mode](#demo-mode)
  - [Feature Flags](#feature-flags)
- [Frontend Variables](#frontend-variables)
  - [Frontend Core](#frontend-core)
  - [Frontend Observability](#frontend-observability)
  - [Frontend Analytics](#frontend-analytics)
  - [Frontend Legacy / Compatibility](#frontend-legacy--compatibility)
- [Validation](#validation)

---

## Quick Start

1. `cp backend/.env.example backend/.env`
2. `cp frontend/.env.example frontend/.env`
3. Set every **Yes** or **Conditional** entry in `backend/.env`.
4. Store all ⚠️ SECRET values in a secrets manager (Vault, AWS Secrets Manager, 1Password, etc.) — never commit real values.

---

## Secret Rotation Guide

### `STELLAR_REBALANCE_SECRET` / `STELLAR_SECRET_KEY`

1. Generate a new Stellar keypair using the [Stellar Lab](https://laboratory.stellar.org) or `stellar keypair generate`.
2. Fund the new account (testnet: Friendbot; mainnet: transfer XLM).
3. Update `STELLAR_REBALANCE_SECRET` in your secrets manager and in `backend/.env`.
4. Restart the backend. The old key is immediately inactive — no grace period is needed because it is used only for signing, not for token verification.
5. Remove the old key from any multi-sig setups and un-fund it if no longer needed.

### `JWT_SECRET`

1. Generate a new 256-bit random value: `openssl rand -base64 32`.
2. Set `JWT_PREVIOUS_SECRET` to the current value of `JWT_SECRET`.
3. Set `JWT_PREVIOUS_SECRET_GRACE_UNTIL` to an ISO 8601 timestamp 15 minutes in the future — long enough for active sessions to refresh.
4. Set `JWT_SECRET` to the new value.
5. Deploy. Both secrets are accepted until the grace period expires.
6. After the grace period, clear `JWT_PREVIOUS_SECRET` and `JWT_PREVIOUS_SECRET_GRACE_UNTIL`.

### `SMTP_PASS`

1. Revoke the old app password in your email provider's security settings.
2. Generate a new app-specific password (Gmail: **Account → Security → App Passwords**).
3. Update `SMTP_PASS` in your secrets manager and redeploy.

### `PGPASSWORD` / `DATABASE_URL`

1. Rotate the password via your Postgres provider (RDS, Neon, Supabase, etc.) or with `ALTER USER`.
2. Update `PGPASSWORD` (or the password segment of `DATABASE_URL`) in your secrets manager.
3. Restart the backend — the connection pool re-establishes with the new credential.
4. Drop or disable the old credential.

### `WEBHOOK_SIGNING_SECRET`

1. Generate a new secret: `openssl rand -base64 32`.
2. Notify upstream webhook consumers to prepare for the new signing key.
3. Update the value in your secrets manager and deploy.
4. Old signatures from in-flight webhooks will be rejected immediately — coordinate a brief maintenance window if needed.

### `COINGECKO_API_KEY` / `VITE_COINGECKO_API_KEY`

1. Log in to the CoinGecko Developer Portal and generate a new API key.
2. Update the value in your secrets manager and redeploy.
3. Revoke the old key in the CoinGecko dashboard.

> `VITE_COINGECKO_API_KEY` is bundled into the browser build. Rotate immediately if the value is discovered in a public bundle, and prefer backend-side key management going forward.

### `NEW_RELIC_LICENSE_KEY`

1. Create a new ingest key under **New Relic → Account Settings → API Keys**.
2. Update the value in your secrets manager and redeploy.
3. Revoke the old key in the New Relic console.

### `SENTRY_DSN` / `VITE_SENTRY_DSN`

Sentry DSNs are project-scoped and do not grant account access, but they can be abused to inject noise events.

1. Rotate the DSN under **Sentry → Project Settings → Client Keys → Revoke**.
2. Update both `SENTRY_DSN` (backend) and `VITE_SENTRY_DSN` (frontend) in your secrets manager and redeploy.

---

## Backend Variables

### Core

| Variable | Required | Default | Description | Example | Security Note |
|---|---|---|---|---|---|
| `NODE_ENV` | No | `development` | Runtime mode controlling startup validation, logging behavior, and feature gating. | `production` | |
| `PORT` | No | `3001` | HTTP API listen port. | `3001` | |
| `STELLAR_NETWORK` | No | `testnet` | Selects `testnet` or `mainnet` defaults for Horizon and Soroban RPC. | `mainnet` | |
| `CORS_ORIGINS` | No | `http://localhost:3000,...` (see `.env.example`) | Comma-separated browser origins allowed to call the API. | `https://app.example.com` | Restrict to your exact production domain in production. |
| `LOG_LEVEL` | No | `info` | Application log verbosity. | `warn` | |
| `LOG_PRETTY` | No | `false` | Pretty-prints logs when `true`; emits JSON lines when `false`. | `true` | |
| `LOG_DEPLOYMENT_ENV` | No | `local` | Deployment-tier label included in log records and telemetry. | `production` | |
| `ENABLE_API_LOGGING` | No | `true` | Enables verbose per-request logging. | `false` | Disable in high-throughput production to reduce log volume. |
| `DEBUG_PRICE_FEEDS` | No | `false` | Emits extra upstream price-feed debug logs. | `true` | |
| `WS_PORT` | No | `3001` | WebSocket listen port (typically shares the HTTP port). | `3001` | |
| `WS_HEARTBEAT_INTERVAL` | No | `30000` | WebSocket ping/pong heartbeat interval (ms). | `30000` | |
| `CI` | No | _(empty)_ | CI environment marker used by scripts and validation checks. | `true` | |

### Database

| Variable | Required | Default | Description | Example | Security Note |
|---|---|---|---|---|---|
| `DATABASE_URL` | No | _(empty)_ | PostgreSQL connection URI. When set, takes priority over discrete `PG*` vars. Falls back to SQLite when unset. | `postgresql://user:pass@localhost:5432/stellar_portfolio` | ⚠️ SECRET — contains credentials. Use a secrets manager; never commit. See [rotation guide](#pgpassword--database_url). |
| `PGHOST` | No | _(empty)_ | PostgreSQL host for discrete connection mode. | `db.example.com` | |
| `PGPORT` | No | `5432` | PostgreSQL port. | `5432` | |
| `PGUSER` | No | _(empty)_ | PostgreSQL username. | `stellar_app` | |
| `PGPASSWORD` | No | _(empty)_ | PostgreSQL password. | _(use secrets manager)_ | ⚠️ SECRET — rotate via your Postgres provider. See [rotation guide](#pgpassword--database_url). |
| `PGDATABASE` | No | _(empty)_ | PostgreSQL database name. | `stellar_portfolio` | |
| `DB_POOL_SIZE` | No | `10` | Maximum number of connections in the PostgreSQL pool. | `20` | |
| `DB_PATH` | No | `./data/portfolio.db` | SQLite database file path used when no PostgreSQL connection is configured. | `./data/portfolio.db` | |

### Stellar & Soroban

| Variable | Required | Default | Description | Example | Security Note |
|---|---|---|---|---|---|
| `STELLAR_HORIZON_URL` | Yes | — | Horizon REST endpoint used for all Stellar chain reads. | `https://horizon-testnet.stellar.org` | |
| `STELLAR_CONTRACT_ADDRESS` | Yes | — | Soroban contract ID (`C...`) for portfolio operations. | `CAAAA...AAAA` | |
| `CONTRACT_ADDRESS` | No | _(empty)_ | Alias for `STELLAR_CONTRACT_ADDRESS`. Must match if both are set. | `CAAAA...AAAA` | |
| `STELLAR_REBALANCE_SECRET` | Conditional | — | Stellar secret key (`S...`) used to sign backend-initiated rebalances. Required unless demo fallback mode is active. | _(use secrets manager)_ | ⚠️ SECRET — never log or expose. See [rotation guide](#stellar_rebalance_secret--stellar_secret_key). |
| `STELLAR_SECRET_KEY` | No | _(empty)_ | Alias for `STELLAR_REBALANCE_SECRET`. | _(use secrets manager)_ | ⚠️ SECRET |
| `REBALANCE_ALLOW_SIGNER_MISMATCH` | No | `false` | Allows the backend signer to differ from the portfolio owner during execution. | `false` | |
| `STELLAR_ASSET_ISSUERS` | No | bundled map | JSON object mapping asset symbol to issuer public key for pricing and rebalance logic. | `{"USDC":"GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"}` | |
| `SOROBAN_RPC_URL` | No | network default | Soroban RPC endpoint for contract event indexing. | `https://soroban-testnet.stellar.org` | |
| `STELLAR_RPC_URL` | No | _(empty)_ | Backward-compatible alias for `SOROBAN_RPC_URL`. | `https://soroban-testnet.stellar.org` | |
| `SOROBAN_EVENT_INDEXER_INTERVAL_MS` | No | `15000` | Poll interval for on-chain contract event sync (ms). | `15000` | |
| `SOROBAN_EVENT_INDEXER_LIMIT` | No | `100` | Maximum events fetched per RPC page. | `100` | |
| `SOROBAN_EVENT_INDEXER_BOOTSTRAP_WINDOW` | No | `500` | Ledger lookback window used on first sync when no cursor exists. | `500` | |
| `SOROBAN_EVENT_INDEXER_MAX_PAGES` | No | `10` | Maximum RPC pages consumed per sync cycle. | `10` | |
| `CONTRACT_EVENT_SCHEMA_VERSION` | No | `1` | Expected contract event schema version. Mismatches block indexing at startup. | `1` | |

### Price Feed

| Variable | Required | Default | Description | Example | Security Note |
|---|---|---|---|---|---|
| `COINGECKO_API_KEY` | No | _(empty)_ | CoinGecko API key for production-grade rate limits. | _(use secrets manager)_ | ⚠️ SECRET — rotate via CoinGecko dashboard. See [rotation guide](#coingecko_api_key--vite_coingecko_api_key). |
| `REFLECTOR_API_URL` | No | _(empty)_ | Reflector oracle API base URL used as an off-chain price fallback. | `https://api.reflector.network` | |
| `PRICE_CACHE_DURATION` | No | `300000` | In-memory price cache TTL (ms). | `300000` | |
| `MIN_REQUEST_INTERVAL` | No | `90000` | Minimum interval between upstream market-data fetches (ms). | `90000` | |

### Auto-Rebalancer

| Variable | Required | Default | Description | Example | Security Note |
|---|---|---|---|---|---|
| `ENABLE_AUTO_REBALANCER` | No | `false` | Enables queue-backed automatic rebalance scheduling. | `true` | |
| `AUTO_REBALANCE_CHECK_INTERVAL` | No | `3600000` | How often the auto-rebalancer checks all portfolios (ms). | `3600000` | |
| `MIN_REBALANCE_INTERVAL` | No | `86400000` | Minimum time between successful rebalances per portfolio (ms). | `86400000` | |
| `MAX_AUTO_REBALANCES_PER_DAY` | No | `3` | Daily cap for automatic rebalances per portfolio. | `3` | |

### API Rate Limiting

| Variable | Required | Default | Description | Example | Security Note |
|---|---|---|---|---|---|
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Global sliding window for request rate limits (ms). | `60000` | |
| `RATE_LIMIT_MAX` | No | `100` | Maximum requests allowed per global window. | `100` | |
| `RATE_LIMIT_WRITE_MAX` | No | `10` | Maximum write requests (POST/PUT/DELETE) per window. | `10` | |
| `RATE_LIMIT_AUTH_MAX` | No | `5` | Maximum auth requests per window. | `5` | |
| `RATE_LIMIT_CRITICAL_MAX` | No | `3` | Maximum critical-operation requests per window. | `3` | |
| `RATE_LIMIT_BURST_WINDOW_MS` | No | `10000` | Burst-protection window size (ms). | `10000` | |
| `RATE_LIMIT_BURST_MAX` | No | `20` | Maximum requests in the burst window. | `20` | |
| `RATE_LIMIT_WRITE_BURST_MAX` | No | `3` | Maximum write requests in the burst window. | `3` | |
| `API_RATE_LIMIT_WINDOW` | No | `900000` | Security-middleware rate-limit window (ms). | `900000` | |
| `API_RATE_LIMIT_MAX_REQUESTS` | No | `100` | Security-middleware max requests per window. | `100` | |

### Redis

| Variable | Required | Default | Description | Example | Security Note |
|---|---|---|---|---|---|
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection URL for BullMQ queues and workers. | `redis://localhost:6379` | ⚠️ SECRET if your Redis instance requires a password (`redis://:password@host:port`). |
| `USE_MEMORY_CACHE` | No | `false` | Enables an in-memory portfolio cache as an alternative to Redis for specific paths. | `false` | |

### Risk Controls

| Variable | Required | Default | Description | Example | Security Note |
|---|---|---|---|---|---|
| `VOLATILITY_THRESHOLD` | No | `15` | Portfolio drift/volatility percentage that triggers a safety check. | `15` | |
| `PRICE_DATA_MAX_AGE` | No | `600` | Maximum accepted age for market data before it is considered stale (seconds). | `600` | |
| `REBALANCE_COOLDOWN_HOURS` | No | `1` | Minimum hours between rebalance actions for a portfolio. | `1` | |
| `MAX_SINGLE_ASSET_CONCENTRATION` | No | `80` | Maximum percentage any single asset may represent in a portfolio. | `80` | |
| `MAX_TRADE_SIZE_PERCENTAGE` | No | `25` | Maximum trade size as a percentage of total portfolio value. | `25` | |
| `MIN_TRADE_SIZE_USD` | No | `10` | Minimum trade size in USD below which a trade is skipped. | `10` | |
| `REBALANCE_MAX_TRADE_SLIPPAGE_BPS` | No | `100` | Per-trade slippage cap (basis points). | `100` | |
| `REBALANCE_MAX_TOTAL_SLIPPAGE_BPS` | No | `250` | Total slippage cap across the full rebalance (basis points). | `250` | |
| `REBALANCE_MAX_SPREAD_BPS` | No | `120` | Maximum bid/ask spread allowed during execution (basis points). | `120` | |
| `REBALANCE_MIN_LIQUIDITY_COVERAGE` | No | `1.0` | Required liquidity coverage multiplier before a trade proceeds. | `1.0` | |
| `REBALANCE_ALLOW_PARTIAL_FILL` | No | `true` | Allows partial order fills when a full fill is unavailable. | `true` | |
| `REBALANCE_ROLLBACK_ON_FAILURE` | No | `true` | Attempts to roll back all changes if execution fails mid-flow. | `true` | |
| `RISK_VOLATILITY_HIGH` | No | `10` | Volatility percentage threshold for high-risk classification. | `10` | |
| `RISK_VOLATILITY_CRITICAL` | No | `15` | Volatility percentage threshold for critical-risk classification. | `15` | |
| `RISK_CONCENTRATION_HIGH` | No | `60` | Concentration percentage threshold for high-risk classification. | `60` | |
| `RISK_CONCENTRATION_CRITICAL` | No | `80` | Concentration percentage threshold for critical-risk classification. | `80` | |
| `RISK_LIQUIDITY_LOW` | No | `1000` | USD liquidity level below which a low-liquidity warning is issued. | `1000` | |
| `RISK_LIQUIDITY_CRITICAL` | No | `500` | USD liquidity level below which a critical alert is issued. | `500` | |

### Security & Auth

| Variable | Required | Default | Description | Example | Security Note |
|---|---|---|---|---|---|
| `JWT_SECRET` | Conditional | _(empty)_ | JWT signing secret. Must be ≥ 32 characters to enable auth. Auth is disabled when empty. | _(use secrets manager)_ | ⚠️ SECRET — rotate using the grace-period flow. See [rotation guide](#jwt_secret). |
| `JWT_PREVIOUS_SECRET` | No | _(empty)_ | Previous JWT secret accepted during key rotation grace period. | _(use secrets manager)_ | ⚠️ SECRET — clear after grace period expires. |
| `JWT_PREVIOUS_SECRET_GRACE_UNTIL` | No | _(empty)_ | ISO 8601 timestamp until which `JWT_PREVIOUS_SECRET` remains valid. | `2026-07-01T12:00:00Z` | |
| `JWT_ACCESS_EXPIRY_SEC` | No | `900` | Access token TTL (seconds). | `900` | |
| `JWT_REFRESH_EXPIRY_SEC` | No | `604800` | Refresh token TTL (seconds). | `604800` | |
| `WEBHOOK_SIGNING_SECRET` | No | _(empty)_ | Secret used to sign outbound webhook payloads and verify inbound callbacks. | _(use secrets manager)_ | ⚠️ SECRET — notify webhook consumers before rotating. See [rotation guide](#webhook_signing_secret). |
| `REQUEST_TIMEOUT` | No | `30000` | Timeout for outbound and internal requests (ms). | `30000` | |
| `ENABLE_REQUEST_VALIDATION` | No | `true` | Enables request payload schema validation. | `true` | |
| `ADMIN_PUBLIC_KEYS` | No | _(empty)_ | Comma-separated Stellar public keys allowed to access privileged admin routes. | `GABC...XYZ,GDEF...UVW` | Restrict to known admin accounts only; audit this list on each rotation. |
| `METRICS_ALLOWLIST` | No | _(empty)_ | Comma-separated IPs/CIDRs permitted to read `/metrics` outside development/test. | `10.0.0.0/8` | |

### Notifications

| Variable | Required | Default | Description | Example | Security Note |
|---|---|---|---|---|---|
| `SMTP_HOST` | No | `smtp.gmail.com` | SMTP server hostname for outbound email. | `smtp.mailgun.org` | |
| `SMTP_PORT` | No | `587` | SMTP port. | `587` | |
| `SMTP_SECURE` | No | `false` | Enables TLS-on-connect (implicit TLS). Use `false` for STARTTLS on port 587. | `false` | |
| `SMTP_USER` | No | `your-email@gmail.com` | SMTP login username. | `alerts@example.com` | |
| `SMTP_PASS` | No | _(empty)_ | SMTP password or Gmail App Password. | _(use secrets manager)_ | ⚠️ SECRET — use an app-specific password, never your account password. See [rotation guide](#smtp_pass). |
| `SMTP_FROM` | No | `noreply@stellarportfolio.com` | Default sender address for outbound notification email. | `noreply@example.com` | |
| `WEBHOOK_TIMEOUT` | No | `5000` | Outbound webhook request timeout (ms). | `5000` | |
| `WEBHOOK_RETRY_COUNT` | No | `1` | Webhook retries after the first failure. Total attempts = `1 + this value`. | `1` | |
| `WEBHOOK_RETRY_DELAY` | No | `1000` | Initial backoff before the first webhook retry (ms). | `1000` | |
| `WEBHOOK_MAX_BACKOFF_MS` | No | `60000` | Exponential backoff ceiling for webhook retries (ms). | `60000` | |
| `WEBHOOK_BACKOFF_MULTIPLIER` | No | `2` | Exponential multiplier for webhook retry delays. Must be ≥ 1. | `2` | |
| `EMAIL_MAX_ATTEMPTS` | No | `3` | Total email delivery attempts including the first try. | `3` | |
| `EMAIL_INITIAL_BACKOFF_MS` | No | `1000` | Initial backoff before the first email retry (ms). | `1000` | |
| `EMAIL_MAX_BACKOFF_MS` | No | `30000` | Exponential backoff ceiling for email retries (ms). | `30000` | |
| `EMAIL_BACKOFF_MULTIPLIER` | No | `2` | Exponential multiplier for email retry delays. Must be ≥ 1. | `2` | |
| `NOTIFICATION_RATE_LIMIT_PER_HOUR` | No | `10` | Maximum notifications sent per user per hour. | `10` | |

### Observability

| Variable | Required | Default | Description | Example | Security Note |
|---|---|---|---|---|---|
| `SENTRY_ENABLED` | No | `false` | Enables the backend Sentry integration. | `true` | |
| `SENTRY_DSN` | No | _(empty)_ | Sentry project DSN for error and performance reporting. | _(see Sentry dashboard)_ | ⚠️ SECRET — if exposed publicly, rotate via Sentry project settings. See [rotation guide](#sentry_dsn--vite_sentry_dsn). |
| `SENTRY_ENVIRONMENT` | No | `development` | Sentry environment tag. Set to the deployed tier, not the local shell mode. | `production` | |
| `SENTRY_RELEASE` | No | _(empty)_ | Sentry release identifier. Use the full git SHA for deployed builds. | `abc1234def5678` | |
| `SENTRY_TRACES_SAMPLE_RATE` | No | `0.2` | Fraction of transactions sent to Sentry as traces (0–1). | `0.05` | |
| `SENTRY_PROFILES_SAMPLE_RATE` | No | `0.1` | Fraction of traces that include profiling data (0–1). | `0.05` | |
| `NEW_RELIC_ENABLED` | No | `false` | Enables the New Relic APM integration. | `true` | |
| `NEW_RELIC_APP_NAME` | No | `stellar-portfolio-backend` | New Relic application name shown in the console. | `stellar-portfolio-production` | |
| `NEW_RELIC_LICENSE_KEY` | No | _(empty)_ | New Relic ingest license key. | _(use secrets manager)_ | ⚠️ SECRET — rotate via New Relic console. See [rotation guide](#new_relic_license_key). |
| `NEW_RELIC_DISTRIBUTED_TRACING_ENABLED` | No | `true` | Enables distributed tracing in New Relic. | `true` | |
| `NEW_RELIC_LOG` | No | `stdout` | New Relic agent log output destination. | `stdout` | |
| `METRICS_ENABLED` | No | `true` | Exposes a Prometheus-compatible `/metrics` endpoint. | `true` | |
| `METRICS_PREFIX` | No | `stellar_portfolio_` | Prefix applied to all emitted metric names. | `stellar_portfolio_` | |
| `METRICS_DEFAULT_LABELS_SERVICE` | No | `stellar-portfolio-backend` | Default service label attached to all emitted metrics. | `stellar-portfolio-backend` | |
| `ALERT_CONTACT` | No | `platform-oncall` | Alert-routing metadata label for operations tooling. | `platform-oncall` | |
| `READINESS_CACHE_TTL_MS` | No | `2000` | Cache TTL for the `/readiness` health endpoint (ms). | `2000` | |

### Analytics & Snapshots

| Variable | Required | Default | Description | Example | Security Note |
|---|---|---|---|---|---|
| `ANALYTICS_SNAPSHOT_INTERVAL` | No | `300000` | Interval between background portfolio snapshot jobs (ms). | `300000` | |
| `MAX_SNAPSHOTS_PER_PORTFOLIO` | No | `1000` | Maximum analytics snapshots retained per portfolio before pruning. | `1000` | |
| `CONSENT_AUDIT_RETENTION_DAYS` | No | `365` | Retention period for consent audit log records (days). | `365` | |

### Demo Mode

| Variable | Required | Default | Description | Example | Security Note |
|---|---|---|---|---|---|
| `DEMO_MODE` | No | `true` | Enables local demo portfolio flows. Set to `false` in production. | `false` | |
| `ALLOW_FALLBACK_PRICES` | No | `true` | Uses fallback price data when the primary feed fails. | `false` | |
| `ALLOW_MOCK_PRICE_HISTORY` | No | `true` | Allows generated historical price data. Disable in production. | `false` | |
| `ALLOW_PUBLIC_USER_PORTFOLIOS_IN_DEMO` | No | `false` | Allows anonymous portfolio listing by user address in demo mode. | `false` | |
| `ENABLE_DEBUG_ROUTES` | No | `true` | Enables debug/test route groups. **Must be `false` in production.** | `false` | ⚠️ Exposes internal test routes and can leak stack traces — the highest-risk flag in this section. |
| `ALLOW_DEMO_BALANCE_FALLBACK` | No | `true` | Uses demo balances when a live on-chain balance fetch fails. | `false` | |
| `ENABLE_DEMO_DB_SEED` | No | `true` | Seeds demo data into the local database at startup. Disable in production. | `false` | |
| `DEMO_INITIAL_BALANCE` | No | `10000` | Starting USD value assigned to demo portfolios. | `10000` | |
| `MOCK_EXTERNAL_APIS` | No | `false` | Mocks all outbound provider calls. For test and CI use only. | `false` | |

### Feature Flags

| Variable | Required | Default | Description | Example | Security Note |
|---|---|---|---|---|---|
| `FEATURE_FLAGS_FILE` | No | _(empty)_ | Path to a local JSON file containing feature flag overrides for staging. | `./feature-flags.json` | |

---

## Frontend Variables

> All `VITE_*` variables are embedded in the browser bundle at build time and are publicly readable.
> Never put private credentials in `VITE_*` variables.

### Frontend Core

| Variable | Required | Default | Description | Example | Security Note |
|---|---|---|---|---|---|
| `VITE_API_URL` | Yes | `http://localhost:3001` | Backend API base URL used for all browser requests. | `https://api.example.com` | Must use HTTPS in production. |
| `VITE_WS_URL` | No | `ws://localhost:3001` | WebSocket base URL. | `wss://api.example.com` | Use `wss://` in production. |
| `VITE_API_VERSION` | No | `v1` | API version prefix appended under `/api`. Set to empty string for legacy `/api`. | `v1` | |
| `VITE_USE_LEGACY_API` | No | `false` | Forces legacy `/api/*` namespace and overrides `VITE_API_VERSION`. | `false` | |
| `VITE_WS_PATH` | No | `/socket.io` | WebSocket path appended to the resolved WebSocket base URL. | `/socket.io` | |
| `VITE_COINGECKO_API_KEY` | No | _(empty)_ | Optional browser-side CoinGecko key for higher price-feed rate limits. | _(use secrets manager)_ | ⚠️ SECRET — bundled into the browser build and visible to end users. Prefer backend-side key management. See [rotation guide](#coingecko_api_key--vite_coingecko_api_key). |
| `VITE_ENABLE_QUERY_DEVTOOLS` | No | `false` | Enables React Query Devtools outside the default development behavior. | `true` | |
| `VITE_ENABLE_BROWSER_PRICE_DEBUG` | No | `false` | Enables verbose price fallback logging in the browser console. | `true` | |
| `VITE_E2E_MOCK_WALLET` | No | _(empty)_ | Enables the deterministic mock wallet used by Playwright E2E tests. | `true` | |

### Frontend Observability

| Variable | Required | Default | Description | Example | Security Note |
|---|---|---|---|---|---|
| `VITE_SENTRY_ENABLED` | No | `false` | Enables the frontend Sentry integration. | `true` | |
| `VITE_SENTRY_DSN` | No | _(empty)_ | Sentry DSN for browser error and session replay reporting. | _(see Sentry dashboard)_ | ⚠️ SECRET — if exposed beyond your app bundle, rotate via Sentry project settings. See [rotation guide](#sentry_dsn--vite_sentry_dsn). |
| `VITE_SENTRY_ENVIRONMENT` | No | `development` | Sentry environment tag. Set to the deployed tier, not the local Vite mode. | `production` | |
| `VITE_SENTRY_RELEASE` | No | _(empty)_ | Sentry release identifier. Use the full git SHA for deployed builds. | `abc1234def5678` | |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | No | `0.1` | Fraction of page transactions sent to Sentry as traces (0–1). | `0.05` | |
| `VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE` | No | `0` | Sentry Session Replay sample rate for normal sessions (0–1). | `0.01` | |
| `VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE` | No | `1` | Sentry Session Replay sample rate for sessions with errors (0–1). | `1` | |

### Frontend Analytics

| Variable | Required | Default | Description | Example | Security Note |
|---|---|---|---|---|---|
| `VITE_ANALYTICS_ENABLED` | No | `false` | Enables privacy-respecting analytics (cookie-free, no PII). Automatically disabled when `VITE_DEMO_MODE=true`. | `true` | |
| `VITE_ANALYTICS_URL` | No | _(empty)_ | Base URL of your self-hosted Umami instance. | `https://analytics.example.com` | |
| `VITE_ANALYTICS_SITE_ID` | No | _(empty)_ | Umami website ID found in the Umami dashboard under **Settings → Websites**. | `a1b2c3d4-e5f6-...` | |

### Frontend Legacy / Compatibility

These variables exist for backward compatibility. Prefer configuring the equivalent backend variables.

| Variable | Required | Default | Description | Example | Security Note |
|---|---|---|---|---|---|
| `VITE_STELLAR_NETWORK` | No | `testnet` | Legacy Stellar network selector. | `mainnet` | |
| `VITE_CONTRACT_ADDRESS` | No | `CA...` | Legacy contract address for frontend-side lookups. | `CAAAA...AAAA` | |
| `VITE_REFLECTOR_ADDRESS` | No | testnet address | Legacy Reflector contract address. | `CDSWUUXGPWDZG76ISK6SUCVPZJMD5YUV66J2FXFXFGDX25XKZJIEITAO` | |
| `VITE_DEMO_MODE` | No | `true` | Legacy demo-mode flag. | `false` | |
| `VITE_DEBUG_API` | No | `false` | Legacy API debug flag. | `false` | |

---

## Validation

Run the same check used by CI whenever you change env examples, runtime env usage, or this document:

```bash
npm run validate:env-examples
```

The validator fails when:

- Required startup keys are missing from either example file.
- Runtime code references an env key absent from its example file.
- Either example file defines a key more than once.
- `backend/.env.example`, `frontend/.env.example`, and the tables in this document drift apart.
