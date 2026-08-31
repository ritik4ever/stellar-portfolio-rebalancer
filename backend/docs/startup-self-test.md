# Backend Startup Self-Test

The backend now exposes a single startup sweep that checks the core runtime dependencies before a deployment or local boot is trusted.

## Command

```bash
cd backend
npm run startup:self-test
```

The script runs the same `src/index.ts` entrypoint with `--startup-self-test`, so it exercises the production boot path without starting the HTTP server.

## What It Checks

- Startup config validation
- Database readiness
- Redis-backed queue readiness
- Stellar network and contract diagnostics
- Price provider connectivity (CoinGecko fallback)
- Reflector oracle reachability — read-only probe of the configured oracle

## Exit Codes

- `0` when all required checks pass — degraded checks do not change the exit code
- `1` when any required check fails

## Failure Output

The command prints a short checklist with remediation hints such as:

- Set `REDIS_URL` and start Redis
- Fix invalid backend environment variables
- Verify Stellar Horizon connectivity and contract deployment
- Check outbound network access to CoinGecko or the configured price provider
- Set or correct `REFLECTOR_API_URL` when the oracle is unreachable

## Check Statuses

| Status | Meaning | Blocks startup |
| --- | --- | --- |
| `passed` | Dependency is healthy | no |
| `degraded` | Dependency is down but the service can still run on a fallback | no |
| `failed` | Required dependency is unusable | yes |

## Reflector Oracle Check (`provider.reflector-oracle`)

A lightweight, read-only `GET {REFLECTOR_API_URL}/prices?assets=<asset>` probe, separate
from `provider.price-feed` (which exercises the CoinGecko fallback) so the diagnostic
points at the oracle rather than the fallback.

The oracle is the primary price source but not a hard dependency — prices fall back to
CoinGecko — so an unreachable oracle is reported as **degraded** and startup continues.
The probe returns a `reason` code, each with its own message and remediation:

| reason | Meaning |
| --- | --- |
| `ok` | Fresh quote returned |
| `not_configured` | `REFLECTOR_API_URL` is unset — fallback prices only |
| `unreachable` | DNS/TCP/TLS failure reaching the oracle |
| `timeout` | No response within the probe timeout (5s) |
| `http_error` | Non-2xx response from the oracle |
| `no_data` | Response contained no price for the probed asset |
| `stale` | Quote older than `PRICE_DATA_MAX_AGE` |

## When To Run It

- Before promoting a new environment
- After changing backend `.env` values
- When queue workers or provider integrations fail to start
