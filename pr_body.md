Closes #1530

## Summary

Implements a comprehensive chaos/load test script (`scripts/chaos/ws-portfolio-feed-load-test.mjs`) that simulates up to thousands of concurrent WebSocket subscriptions against the `portfolioFeed.ts` endpoint in order to measure connection acceptance latency, message delivery latency, and server resource usage under load. The test identifies and documents the practical concurrent-connection ceiling for current infrastructure sizing, enabling data-driven capacity planning.

---

## What was added

### New Script: `scripts/chaos/ws-portfolio-feed-load-test.mjs`

A standalone Node.js ESM script that stress-tests the WebSocket portfolio feed endpoint (`/ws/portfolio/:id`) with configurable concurrency. Phase breakdown:

| Phase | Description |
|-------|-------------|
| **Phase 1: Health Check** | Verifies the backend is reachable via `GET /health` before starting |
| **Phase 2: Ramp Up** | Opens WebSocket connections in configurable batches (supports `batch` and `linear` ramp strategies) |
| **Phase 3: Sustain** | Maintains all open connections for a configurable duration while collecting message delivery metrics and server resource samples |
| **Phase 4: Teardown** | Gracefully closes all connections with `1000` close code |
| **Phase 5: Report** | Generates a comprehensive latency and resource report with capacity planning assessment |

### Metrics Collected

| Metric | Description |
|--------|-------------|
| **Connection Acceptance Latency** | Time from `new WebSocket()` to `open` event, with P50/P75/P95/P99/max/mean |
| **First Message Delivery Latency** | Time from `CONNECTION_ACK` to first `PORTFOLIO_VALUE_UPDATE` |
| **Message Delivery Latency** | Server timestamp vs. client receipt time for all `PORTFOLIO_VALUE_UPDATE` broadcasts |
| **Message Throughput** | Total messages received and messages-per-second rate during sustain |
| **Server Resource Usage** | Polls backend `/metrics` endpoint periodically during sustain phase |
| **Client Overhead** | Tracks heap usage, RSS, and external memory of the load generator itself |
| **Connection Drop Rate** | Connections that unexpectedly closed during the sustain phase |
| **Connection Failure Rate** | Connections that failed to establish or receive `CONNECTION_ACK` |

### Ceiling Assessment

The script automatically assesses the practical connection ceiling based on:
- Connection failure rate (>10% → degraded)
- Connection drop rate during sustain (>5% → degraded)
- P95 connection latency (>5s → degraded)
- P95 message delivery latency (>2s → degraded)

When no issues are detected, it reports the tested concurrency level as the _minimum_ ceiling and recommends re-running with higher concurrency to find the true limit. When issues are detected, it estimates the practical ceiling using a penalty factor.

### Configuration (Environment Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `CHAOS_WS_BACKEND_URL` | `http://localhost:3001` | Backend base URL |
| `CHAOS_WS_CONCURRENT_CONNECTIONS` | `100` | Total WebSocket connections to simulate |
| `CHAOS_WS_BATCH_SIZE` | `10` | Connections to open per batch |
| `CHAOS_WS_BATCH_DELAY_MS` | `200` | Delay between batches |
| `CHAOS_WS_DURATION_MS` | `60000` | How long to sustain load (ms) |
| `CHAOS_WS_PORTFOLIO_ID_PREFIX` | `load-test-pf` | Prefix for generated portfolio IDs |
| `CHAOS_WS_JWT_SECRET` | auto-generated | JWT secret for token generation |
| `CHAOS_WS_AUTH_ENABLED` | `false` | Whether to require JWT auth tokens |
| `CHAOS_WS_VERBOSE` | unset | Enable debug-level logging |
| `CHAOS_WS_TIMEOUT_MS` | `10000` | Individual connection timeout |
| `CHAOS_WS_RAMP_STRATEGY` | `batch` | `batch` or `linear` ramp strategy |

### Usage

```bash
# Run with defaults (100 connections, 60s sustain)
npm run test:chaos:ws-load

# Run with custom concurrency
CHAOS_WS_CONCURRENT_CONNECTIONS=500 CHAOS_WS_DURATION_MS=120000 \
  npm run test:chaos:ws-load

# Run with auth enabled (requires backend JWT secret)
CHAOS_WS_AUTH_ENABLED=true CHAOS_WS_JWT_SECRET=my-secret-key \
  npm run test:chaos:ws-load
```

### CI Integration

The script is added to the root `package.json` as `test:chaos:ws-load` alongside the existing `test:chaos` script. It can be integrated into CI for periodic capacity verification:

```json
"test:chaos:ws-load": "node scripts/chaos/ws-portfolio-feed-load-test.mjs"
```

---

## Acceptance Criteria

- ✅ Load test can simulate a **configurable number** of concurrent WS subscriptions (via `CHAOS_WS_CONCURRENT_CONNECTIONS`)
- ✅ Test produces a report on **latency** (connection, first-message, delivery with P50/P75/P95/P99) and **resource usage** (server `/metrics` + client overhead) under the simulated load
- ✅ **Practical connection ceiling** is documented for capacity planning (automatic `assessCeiling()` function)
- ✅ Script follows existing chaos test patterns (`kill-backend-mid-rebalance.mjs`) with consistent logging, env var configuration, and phased execution

---

## Review Fixes

Resolves the technical issues raised in the PR thread:

- **Intentional disconnects no longer counted as failures.** The teardown phase closes every open connection with close code `1000`. Previously the `close` handler incremented `connectionsDropped` for any connection closed while in the `open` state, so the intentional teardown inflated the drop rate to ~100% and corrupted the ceiling assessment and reported metrics. Connections are now marked `intentionalClose` before teardown and their closes are excluded from the drop/failure counts (`dropRate` reflects only unexpected disconnects during the sustain phase).
- **JWT secret no longer serialized into CI artifacts.** The results JSON previously persisted the full `CONFIG` object, including the JWT secret, and the results file is uploaded as a public workflow artifact (`ws-load-test-report`). The persisted `configuration` now redacts `jwtSecret` via `sanitizeConfig()`. The workflow also no longer hardcodes plaintext `JWT_SECRET` values; it generates an ephemeral random secret at runtime with `openssl rand -hex 32`.
- **CI job now authenticates correctly.** `portfolioFeed.ts` unconditionally requires a valid JWT, so the load test job now runs with `CHAOS_WS_AUTH_ENABLED=true` and passes the same runtime secret as `CHAOS_WS_JWT_SECRET`, ensuring the tokens signed by the test validate against the backend.
- **Rebased onto the base branch** (231 commits behind at the time of rebasing) to restore compatibility and keep the PR mergeable.

---

## Files Changed

### New files
- `scripts/chaos/ws-portfolio-feed-load-test.mjs` — Load test script

### Modified files
- `package.json` — Added `"test:chaos:ws-load"` script entry
- `.github/workflows/performance-test.yml` — CI integration for the load test; no longer hardcodes `JWT_SECRET`
- `pr_body.md` — PR description
