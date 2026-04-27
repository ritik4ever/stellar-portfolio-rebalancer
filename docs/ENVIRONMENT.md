# Backend Environment Variables

This document is the canonical reference for `backend/.env.example`.

## Usage

1. Copy `backend/.env.example` to `backend/.env`.
2. Set all required values.
3. Keep optional values at defaults unless you need different behavior.

## Variable Reference

| Variable | Type | Required | Default | Description |
|---|---|---|---|---|
| `NODE_ENV` | enum | No | `development` | Runtime mode for startup validation and feature behavior. |
| `PORT` | integer | No | `3001` | HTTP API listen port. |
| `STELLAR_NETWORK` | enum | No | `testnet` | Selects `testnet` or `mainnet` defaults for Stellar services. |
| `STELLAR_HORIZON_URL` | URL | Yes | - | Horizon endpoint used for chain reads. |
| `STELLAR_CONTRACT_ADDRESS` | string | Yes | - | Soroban contract ID (`C...`) used by the backend. |
| `CONTRACT_ADDRESS` | string | No | empty | Alias of `STELLAR_CONTRACT_ADDRESS`; must match if both are set. |
| `STELLAR_REBALANCE_SECRET` | string | Conditionally | - | Signing secret for rebalance execution; required unless demo fallback mode is active. |
| `STELLAR_SECRET_KEY` | string | No | empty | Alias of `STELLAR_REBALANCE_SECRET`. |
| `REBALANCE_ALLOW_SIGNER_MISMATCH` | boolean | No | `false` | Allows signer mismatch between backend signer and portfolio owner. |
| `STELLAR_ASSET_ISSUERS` | JSON object | No | template map | Issuer map for non-native assets used in pricing/rebalance logic. |
| `DATABASE_URL` | connection string | No | empty | PostgreSQL connection URI. |
| `PGHOST` | string | No | empty | PostgreSQL host (discrete connection mode). |
| `PGPORT` | integer | No | `5432` | PostgreSQL port. |
| `PGUSER` | string | No | empty | PostgreSQL user. |
| `PGPASSWORD` | string | No | empty | PostgreSQL password. |
| `PGDATABASE` | string | No | empty | PostgreSQL database name. |
| `CI` | string | No | empty | CI marker used by scripts/runtime checks. |
| `DB_PATH` | path | No | `./data/portfolio.db` | SQLite database path for local/test fallback. |
| `COINGECKO_API_KEY` | string | No | empty | CoinGecko API key for higher rate limits. |
| `PRICE_CACHE_DURATION` | integer (ms) | No | `300000` | Price-cache TTL. |
| `MIN_REQUEST_INTERVAL` | integer (ms) | No | `90000` | Minimum delay between upstream market-data requests. |
| `ENABLE_AUTO_REBALANCER` | boolean | No | `false` | Enables automatic rebalance scheduling. |
| `AUTO_REBALANCE_CHECK_INTERVAL` | integer (ms) | No | `3600000` | Auto-rebalancer check interval. |
| `MIN_REBALANCE_INTERVAL` | integer (ms) | No | `86400000` | Minimum time between rebalances per portfolio. |
| `MAX_AUTO_REBALANCES_PER_DAY` | integer | No | `3` | Daily limit of automatic rebalances per portfolio. |
| `RATE_LIMIT_WINDOW_MS` | integer (ms) | No | `60000` | Global request rate-limit window. |
| `RATE_LIMIT_MAX` | integer | No | `100` | Global max requests per window. |
| `RATE_LIMIT_WRITE_MAX` | integer | No | `10` | Max write requests per window. |
| `RATE_LIMIT_AUTH_MAX` | integer | No | `5` | Max auth requests per window. |
| `RATE_LIMIT_CRITICAL_MAX` | integer | No | `3` | Max critical-operation requests per window. |
| `RATE_LIMIT_BURST_WINDOW_MS` | integer (ms) | No | `10000` | Burst-protection window. |
| `RATE_LIMIT_BURST_MAX` | integer | No | `20` | Max requests in burst window. |
| `RATE_LIMIT_WRITE_BURST_MAX` | integer | No | `3` | Max write requests in burst window. |
| `REDIS_URL` | URL | No | `redis://localhost:6379` | Redis endpoint for BullMQ queues/workers. |
| `USE_MEMORY_CACHE` | boolean | No | `false` | Enables in-memory cache for specific runtime paths. |
| `VOLATILITY_THRESHOLD` | number | No | `15` | Volatility threshold used by safety checks. |
| `PRICE_DATA_MAX_AGE` | integer (s) | No | `600` | Maximum accepted market-data age. |
| `REBALANCE_COOLDOWN_HOURS` | integer | No | `1` | Cooldown duration between rebalance actions. |
| `MAX_SINGLE_ASSET_CONCENTRATION` | number | No | `80` | Concentration cap for one asset. |
| `MAX_TRADE_SIZE_PERCENTAGE` | number | No | `25` | Maximum trade size as portfolio percent. |
| `MIN_TRADE_SIZE_USD` | number | No | `10` | Minimum trade size in USD. |
| `REBALANCE_MAX_TRADE_SLIPPAGE_BPS` | integer | No | `100` | Per-trade slippage cap (bps). |
| `REBALANCE_MAX_TOTAL_SLIPPAGE_BPS` | integer | No | `250` | Total slippage cap per rebalance (bps). |
| `REBALANCE_MAX_SPREAD_BPS` | integer | No | `120` | Max spread allowed for execution (bps). |
| `REBALANCE_MIN_LIQUIDITY_COVERAGE` | number | No | `1.0` | Required liquidity coverage multiplier. |
| `REBALANCE_ALLOW_PARTIAL_FILL` | boolean | No | `true` | Allows partial fills when needed. |
| `REBALANCE_ROLLBACK_ON_FAILURE` | boolean | No | `true` | Attempts rollback if execution fails mid-flow. |
| `SMTP_HOST` | string | No | `smtp.gmail.com` | SMTP host for email notifications. |
| `SMTP_PORT` | integer | No | `587` | SMTP port. |
| `SMTP_SECURE` | boolean | No | `false` | Enables TLS-on-connect SMTP mode. |
| `SMTP_USER` | string | No | `your-email@gmail.com` | SMTP username/login. |
| `SMTP_PASS` | string | No | `your-app-password` | SMTP password or app password. |
| `SMTP_FROM` | email | No | `noreply@stellarportfolio.com` | Default sender address for outgoing email. |
| `ADMIN_PUBLIC_KEYS` | CSV | No | empty | Admin addresses allowed to hit privileged endpoints. |
| `WEBHOOK_TIMEOUT` | integer (ms) | No | `5000` | Outgoing webhook timeout. |
| `WEBHOOK_RETRY_COUNT` | integer | No | `1` | Number of webhook retries. |
| `WEBHOOK_RETRY_DELAY` | integer (ms) | No | `1000` | Delay between webhook retries. |
| `NOTIFICATION_RATE_LIMIT_PER_HOUR` | integer | No | `10` | Hourly notification cap per user. |
| `CORS_ORIGINS` | CSV URLs | No | localhost list | Allowed browser origins for CORS. |
| `LOG_LEVEL` | enum | No | `info` | Application log level. |
| `LOG_PRETTY` | boolean | No | `false` | Pretty logs when true; JSON logs when false. |
| `LOG_DEPLOYMENT_ENV` | string | No | `local` | Extra deployment label for logs/metrics. |
| `ENABLE_API_LOGGING` | boolean | No | `true` | Enables verbose API request logging. |
| `DEBUG_PRICE_FEEDS` | boolean | No | `false` | Emits extra market-feed debug logs. |
| `WS_PORT` | integer | No | `3001` | WebSocket port if not sharing the API server port. |
| `WS_HEARTBEAT_INTERVAL` | integer (ms) | No | `30000` | WebSocket ping/pong heartbeat interval. |
| `RISK_VOLATILITY_HIGH` | number | No | `10` | High-risk volatility threshold. |
| `RISK_VOLATILITY_CRITICAL` | number | No | `15` | Critical-risk volatility threshold. |
| `RISK_CONCENTRATION_HIGH` | number | No | `60` | High-risk concentration threshold. |
| `RISK_CONCENTRATION_CRITICAL` | number | No | `80` | Critical-risk concentration threshold. |
| `RISK_LIQUIDITY_LOW` | number | No | `1000` | Low-liquidity threshold. |
| `RISK_LIQUIDITY_CRITICAL` | number | No | `500` | Critical-liquidity threshold. |
| `ANALYTICS_SNAPSHOT_INTERVAL` | integer (ms) | No | `300000` | Interval for analytics snapshot jobs. |
| `MAX_SNAPSHOTS_PER_PORTFOLIO` | integer | No | `1000` | Snapshot retention cap per portfolio. |
| `JWT_SECRET` | string | Conditionally | empty | Enables auth when set and length is at least 32 chars. |
| `JWT_ACCESS_EXPIRY_SEC` | integer (s) | No | `900` | Access token TTL. |
| `JWT_REFRESH_EXPIRY_SEC` | integer (s) | No | `604800` | Refresh token TTL. |
| `API_RATE_LIMIT_WINDOW` | integer (ms) | No | `900000` | Security middleware rate-limit window. |
| `API_RATE_LIMIT_MAX_REQUESTS` | integer | No | `100` | Security middleware max requests per window. |
| `REQUEST_TIMEOUT` | integer (ms) | No | `30000` | Request timeout setting. |
| `ENABLE_REQUEST_VALIDATION` | boolean | No | `true` | Enables request payload validation. |
| `DEMO_MODE` | boolean | No | `true` | Enables local demo portfolio flows. |
| `ALLOW_FALLBACK_PRICES` | boolean | No | `true` | Uses fallback prices when providers fail. |
| `ALLOW_MOCK_PRICE_HISTORY` | boolean | No | `true` | Allows generated historical price data. |
| `ENABLE_DEBUG_ROUTES` | boolean | No | `true` | Enables debug/test routes. |
| `ALLOW_DEMO_BALANCE_FALLBACK` | boolean | No | `true` | Uses demo balances when on-chain fetch fails. |
| `ENABLE_DEMO_DB_SEED` | boolean | No | `true` | Seeds demo DB records at startup. |
| `DEMO_INITIAL_BALANCE` | number | No | `10000` | Starting demo portfolio value in USD. |
| `MOCK_EXTERNAL_APIS` | boolean | No | `false` | Mocks outbound provider calls in test/dev flows. |
| `SOROBAN_RPC_URL` | URL | No | empty | Explicit Soroban RPC endpoint for contract indexer. |
| `STELLAR_RPC_URL` | URL | No | empty | Backward-compatible alias of `SOROBAN_RPC_URL`. |
| `SOROBAN_EVENT_INDEXER_INTERVAL_MS` | integer (ms) | No | `15000` | Poll interval for contract event indexing. |
| `SOROBAN_EVENT_INDEXER_LIMIT` | integer | No | `100` | Max events fetched per RPC page. |
| `SOROBAN_EVENT_INDEXER_BOOTSTRAP_WINDOW` | integer | No | `500` | Ledger lookback window on first sync. |
| `SOROBAN_EVENT_INDEXER_MAX_PAGES` | integer | No | `10` | Max pages fetched per sync cycle. |
| `CONTRACT_EVENT_SCHEMA_VERSION` | integer | No | `1` | Declares expected contract-event schema version. |
| `SENTRY_ENABLED` | boolean | No | `false` | Enables backend Sentry integration. |
| `SENTRY_DSN` | URL | No | empty | Sentry DSN. |
| `SENTRY_ENVIRONMENT` | string | No | `development` | Sentry environment tag. |
| `SENTRY_RELEASE` | string | No | empty | Sentry release identifier. |
| `SENTRY_TRACES_SAMPLE_RATE` | number | No | `0.2` | Sentry traces sample rate (0-1). |
| `SENTRY_PROFILES_SAMPLE_RATE` | number | No | `0.1` | Sentry profiling sample rate (0-1). |
| `NEW_RELIC_ENABLED` | boolean | No | `false` | Enables New Relic APM integration. |
| `NEW_RELIC_APP_NAME` | string | No | `stellar-portfolio-backend` | New Relic app name. |
| `NEW_RELIC_LICENSE_KEY` | string | No | empty | New Relic license key. |
| `NEW_RELIC_DISTRIBUTED_TRACING_ENABLED` | boolean | No | `true` | Enables distributed tracing in New Relic. |
| `NEW_RELIC_LOG` | string | No | `stdout` | New Relic agent log output target. |
| `METRICS_ENABLED` | boolean | No | `true` | Exposes Prometheus metrics endpoint. |
| `METRICS_PREFIX` | string | No | `stellar_portfolio_` | Prefix applied to metric names. |
| `METRICS_DEFAULT_LABELS_SERVICE` | string | No | `stellar-portfolio-backend` | Default service label for metrics. |
| `ALERT_CONTACT` | string | No | `platform-oncall` | Alert-routing metadata label for operations. |
