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
- Price provider connectivity

## Exit Codes

- `0` when all required checks pass
- `1` when any required check fails

## Failure Output

The command prints a short checklist with remediation hints such as:

- Set `REDIS_URL` and start Redis
- Fix invalid backend environment variables
- Verify Stellar Horizon connectivity and contract deployment
- Check outbound network access to CoinGecko or the configured price provider

## When To Run It

- Before promoting a new environment
- After changing backend `.env` values
- When queue workers or provider integrations fail to start
