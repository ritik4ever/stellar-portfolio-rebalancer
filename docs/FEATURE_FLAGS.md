# Feature flags and environment toggles

Single reference for backend and frontend switches that change runtime behavior. Source of truth for backend booleans is `backend/src/config/featureFlags.ts` (plus `backend/src/config/startupConfig.ts` for production guardrails).

## Backend (Node / API)

| Variable | Default (non‑prod) | Default (production) | Effect |
|----------|-------------------|----------------------|--------|
| `DEMO_MODE` | `true` | `false` (required) | Demo portfolio paths, simulated balances where wired, aligns with demo seed and mock history defaults. Production **must** be `false` or the process exits. |
| `ALLOW_FALLBACK_PRICES` | `true` | `false` | When live CoinGecko fails and cache is empty, serve synthetic prices from `ReflectorService`. Unsafe for production pricing. |
| `ALLOW_MOCK_PRICE_HISTORY` | follows `DEMO_MODE` | follows `DEMO_MODE` | When chart/history API fails, generate mock series instead of erroring. |
| `ALLOW_DEMO_BALANCE_FALLBACK` | follows `DEMO_MODE` | follows `DEMO_MODE` | Demo-style balance fallbacks in `StellarService` when real reads fail. |
| `ENABLE_DEMO_DB_SEED` | follows `DEMO_MODE` | follows `DEMO_MODE` | Seed demo rows when DB is empty (`databaseService`). |
| `ALLOW_PUBLIC_USER_PORTFOLIOS_IN_DEMO` | `false` | `false` | Allow unauthenticated listing of user portfolios in demo contexts. |
| `ENABLE_DEBUG_ROUTES` | `false` | `false` | Mount `/api/v1/debug/*` (and legacy `/api/debug/*`). Keep off in shared/staging unless you trust the network. |

**Indexer / contract alignment**

| Variable | Purpose |
|----------|---------|
| `CONTRACT_EVENT_SCHEMA_VERSION` | Optional. If set, must equal `BACKEND_CONTRACT_EVENT_SCHEMA_VERSION` in `backend/src/config/contractEventSchema.ts` or the contract event indexer refuses to ingest. |

Public copies of the main booleans are exposed on `GET /api/v1/system/status` under `featureFlags` (same names, uppercase keys).

## Frontend (Vite)

| Variable | Notes |
|----------|--------|
| `VITE_API_URL` | API base URL. |
| `VITE_DEMO_MODE` | Present in `.env.example`; not all UI paths read it (some demo state is local). |
| `VITE_ENABLE_API_DEBUG_LOGS` | Verbose API logging via `frontend/src/utils/debug.ts`. |
| `API_CONFIG.USE_BROWSER_PRICES` | **Code flag** in `frontend/src/config/api.ts` (currently `true`): GET `/prices` uses `browserPriceService` in the browser instead of the backend envelope. |

## Safe combinations

**Local development**

- `DEMO_MODE=true`, `ALLOW_FALLBACK_PRICES=true`, `ENABLE_DEBUG_ROUTES=true` (only if you need debug routes), `ENABLE_DEMO_DB_SEED=true` for quick DB fixtures.
- Omit `CONTRACT_EVENT_SCHEMA_VERSION` until you deploy a contract; then set it to the value in `contractEventSchema.ts`.

**CI / automated tests**

- Match your workflow env (see `.github/workflows`). Typically `DEMO_MODE=true`, `ALLOW_DEMO_BALANCE_FALLBACK=true`, no debug routes, no production `DEMO_MODE`.

**Production**

- `DEMO_MODE=false`, `ALLOW_FALLBACK_PRICES=false`, `ENABLE_DEBUG_ROUTES=false`, `ALLOW_MOCK_PRICE_HISTORY=false` unless you explicitly accept mock charts.
- Set `CONTRACT_EVENT_SCHEMA_VERSION` to the backend’s expected version whenever the indexer is enabled.

## Examples

- **Strict pricing:** `ALLOW_FALLBACK_PRICES=false`, `ALLOW_MOCK_PRICE_HISTORY=false` — failures surface as errors instead of synthetic numbers.
- **Contributor debugging:** `ENABLE_DEBUG_ROUTES=true` locally, hit `/api/v1/debug/force-fresh-prices` (still requires the debug gate middleware).
- **Demo kiosk:** `DEMO_MODE=true`, `ENABLE_DEMO_DB_SEED=true`, `ALLOW_PUBLIC_USER_PORTFOLIOS_IN_DEMO=false` unless you understand the data exposure.

## See also

- `docs/CONTRACT_EVENTS.md` — contract event topics and schema version.
- `backend/.env.example` and `frontend/.env.example` — full lists with placeholders.
