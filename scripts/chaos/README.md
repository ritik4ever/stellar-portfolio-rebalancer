# Chaos Engineering Tests

This directory contains chaos engineering tests to validate system resilience under failure conditions.

## Available Tests

### kill-backend-mid-rebalance.mjs

Validates system resilience when the backend process is terminated during an active rebalance operation.

**Usage:**
```bash
node scripts/chaos/kill-backend-mid-rebalance.mjs
CHAOS_VERBOSE=1 node scripts/chaos/kill-backend-mid-rebalance.mjs
```

**Environment Variables:**
- `CHAOS_BACKEND_PORT` - Backend port (default: 3001)
- `CHAOS_KILL_DELAY_MS` - Delay before kill in ms (default: 500)
- `CHAOS_STARTUP_TIMEOUT` - Max ms to wait for backend ready (default: 30000)
- `CHAOS_RESTART_TIMEOUT` - Max ms to wait for backend restart (default: 30000)
- `CHAOS_PORTFOLIO_ID` - Portfolio ID to use (default: auto-detected or demo)
- `CHAOS_VERBOSE` - Stream backend stdout/stderr when set

### reflector-oracle-outage.mjs

Validates system resilience when the Reflector oracle becomes unavailable during an in-progress scheduled rebalance. Verifies that the system falls back gracefully via circuit breaker or secondary oracle rather than corrupting portfolio state.

**Usage:**
```bash
# Run against staging environment (default)
CHAOS_ENVIRONMENT=staging node scripts/chaos/reflector-oracle-outage.mjs

# With verbose output
CHAOS_ENVIRONMENT=staging CHAOS_VERBOSE=1 node scripts/chaos/reflector-oracle-outage.mjs
```

**Environment Variables:**
- `CHAOS_BACKEND_PORT` - Backend port (default: 3001)
- `CHAOS_OUTAGE_DELAY_MS` - Delay before simulating outage in ms (default: 1000)
- `CHAOS_OUTAGE_DURATION_MS` - Duration of simulated outage in ms (default: 5000)
- `CHAOS_STARTUP_TIMEOUT` - Max ms to wait for backend ready (default: 30000)
- `CHAOS_RECOVERY_TIMEOUT` - Max ms to wait for backend recovery (default: 30000)
- `CHAOS_PORTFOLIO_ID` - Portfolio ID to use (default: auto-detected or demo)
- `CHAOS_VERBOSE` - Stream backend stdout/stderr when set
- `CHAOS_ENVIRONMENT` - Target environment (default: staging)

**⚠️ IMPORTANT:** This script should only be run against a staging environment. Never run against production without explicit approval. The script will exit with an error if `CHAOS_ENVIRONMENT=production` is set.

## Running Chaos Tests Safely

### Against Staging Environment

1. Ensure the staging environment is deployed and healthy
2. Set the environment variable to target staging:
   ```bash
   export CHAOS_ENVIRONMENT=staging
   ```
3. Run the desired chaos test:
   ```bash
   node scripts/chaos/reflector-oracle-outage.mjs
   ```
4. Review the generated report:
   ```bash
   cat chaos-oracle-outage-report.json
   ```

### Against Local Development

For local testing, the chaos scripts can run against a locally running backend:

```bash
# Start the backend in one terminal
cd backend && npm run dev

# In another terminal, run the chaos test
node scripts/chaos/kill-backend-mid-rebalance.mjs
```

## Reports

Chaos tests generate JSON reports in the project root for post-run review:

- `chaos-oracle-outage-report.json` - Report from Reflector oracle outage test
- Additional reports may be added for other chaos scenarios

Report format:
```json
{
  "timestamp": "2026-07-28T21:30:00.000Z",
  "environment": "staging",
  "test": "reflector-oracle-outage",
  "configuration": {
    "outageDelayMs": 1000,
    "outageDurationMs": 5000,
    "portfolioId": "auto-detected"
  },
  "results": {
    "passed": 1,
    "failed": 0,
    "scenarios": [
      {
        "name": "oracle-outage-during-rebalance",
        "passed": true
      }
    ]
  }
}
```

## Best Practices

1. **Always run against staging first** - Never run chaos tests against production without explicit approval and a rollback plan
2. **Review reports** - Analyze the generated reports to understand system behavior during failures
3. **Test during low traffic** - Schedule chaos tests during periods of low user activity
4. **Have rollback plans** - Ensure you can quickly restore service if a chaos test causes unexpected issues
5. **Document findings** - Share insights from chaos tests with the team to improve system resilience

## Adding New Chaos Tests

When adding a new chaos test:

1. Create a new `.mjs` file in this directory
2. Follow the structure of existing tests (logging, assertions, report generation)
3. Add safety checks to prevent running against production
4. Update this README with usage instructions
5. Ensure the test generates a report for post-run review
