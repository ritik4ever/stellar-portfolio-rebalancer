# API documentation

> **Last verified:** 2026-09-30 against commit `a5154c2f0deb9d75b689c13a4f5a092891b89702` on `main`.

The HTTP API (versioning, envelopes, and endpoint overview) lives in the repository root:

**[API.md](../API.md)**

## Contract error codes

When the backend invokes the on-chain Soroban contract, failures surface as numeric
error codes. The canonical mapping between contract error codes and HTTP API error
responses is maintained in:

**[CONTRACT_ABI.md → Canonical Error Mapping](../contracts/CONTRACT_ABI.md#canonical-error-mapping-contract--api)**

## Operational endpoints

These unversioned endpoints support health checks and monitoring:

| Endpoint           | Purpose                                                       |
|--------------------|--------------------------------------------------------------|
| `GET /health`      | Plain-text `200 ok` liveness probe for load balancers.       |
| `GET /api/health`  | JSON `{ status, timestamp }` API health.                     |
| `GET /ready`, `GET /readiness` | Deep readiness probe (DB, Redis/queues, workers, indexer); returns `503` until ready. |
| `GET /metrics`     | Prometheus metrics exposition.                               |

To probe these surfaces across environments, use the health smoke script (`npm run smoke`). See **[OPERATIONS.md](OPERATIONS.md#health-smoke-test)** for usage and the health-vs-readiness distinction.

### Worked example: confirm a local backend is serving

The most common case for a first-time contributor is "is the API up and healthy?". The backend listens on port `3001` by default (`PORT` overrides it), so probe `http://localhost:3001` and read the result.

The response bodies, statuses, and key names below come from the route handlers in `backend/src/index.ts` and `backend/src/api/ops.routes.ts`, and the smoke transcript is the output format of `scripts/health-smoke.sh`. Per-request timings are representative and will differ on your machine.

**Step 1 — confirm the process is bound.** Start the API from `backend/` (`npm run dev`). The bind is logged as JSON and contains:

```text
[SERVER] Listening on port 3001
```

**Step 2 — probe liveness.** This is the plain-text surface a load balancer uses:

```bash
curl -i http://localhost:3001/health
```

Expected response:

```text
HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8

ok
```

`GET /health` never calls the database, Redis, Horizon, or Soroban. A body other than `ok`, or any status other than `200`, means something other than this API is listening on port 3001.

**Step 3 — probe dependencies.** Unlike `/health`, this endpoint runs live checks and names what it found:

```bash
curl -s http://localhost:3001/api/health | jq
```

Expected response when every dependency is reachable:

```json
{
  "status": "healthy",
  "timestamp": "2026-09-30T10:31:04.882Z",
  "dependencies": {
    "database": { "status": "ok", "latency_ms": 2, "last_checked": "2026-09-30T10:31:04.880Z" },
    "redis": { "status": "ok", "latency_ms": 1, "last_checked": "2026-09-30T10:31:04.881Z" },
    "stellar_horizon": { "status": "ok", "latency_ms": 84, "last_checked": "2026-09-30T10:31:04.882Z" },
    "reflector_oracle": { "status": "ok", "latency_ms": 57, "last_checked": "2026-09-30T10:31:04.882Z" }
  }
}
```

Each dependency reports `ok`, `degraded`, or `down`. A `degraded` dependency still answers `200` with `"status": "healthy"`; only a `down` dependency flips the response to `503` with `"status": "unhealthy"`, so this object is where you find out which one broke.

**Step 4 — probe all four surfaces at once.** From the repository root:

```bash
npm run smoke
```

Expected output:

```text
Health smoke test → http://localhost:3001  (target: local, timeout: 10s)
-------------------------------------------------------------------------
  ✓ liveness    /health       200 (0.003s)
  ✓ api-health  /api/health   200 (0.041s)
  ✓ readiness   /ready        200 (0.012s)
  ✓ api-root    /             200 (0.004s)
  ✓ api-docs    /api-docs     200 (0.006s)
  ✓ metrics     /metrics      200 (0.009s)
-------------------------------------------------------------------------
Summary: 6 passed, 0 failed, 0 warning(s)
✓ Health smoke test passed for http://localhost:3001
```

Exit code `0`. `/metrics` answers `200` here because the probe comes from loopback (or because `NODE_ENV` is `development`), either of which is allowed by the metrics allowlist.

**Step 5 — read a non-zero result.** Only `liveness` and `api-health` are required, so the other four degrade to warnings and the run still exits `0`:

```text
  ⚠ readiness   /ready        WARN — expected HTTP 200, got 503
```

A warning does not gate a deploy. A `✗` on a required check does — this run exits `1`:

```text
  ✗ api-health  /api/health   FAIL — expected HTTP 200, got 503
```

That is the same `503` as step 3, and the `dependencies` object from `curl` is what tells you whether it was Redis, the database, Horizon, or the oracle.

On a fresh start with no Redis, `/ready` and `/readiness` legitimately return `503` with `"status": "not_ready"` — they are the same handler, and they aggregate the database, Redis/queues, queue backlog, workers, the contract event indexer, and the auto-rebalancer. That is the warning in step 5, not a failure.
