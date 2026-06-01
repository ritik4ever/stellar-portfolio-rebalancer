# API documentation

The HTTP API (versioning, envelopes, and endpoint overview) lives in the repository root:

**[API.md](../API.md)**

## Operational endpoints

These unversioned endpoints support health checks and monitoring:

| Endpoint           | Purpose                                                       |
|--------------------|--------------------------------------------------------------|
| `GET /health`      | Plain-text `200 ok` liveness probe for load balancers.       |
| `GET /api/health`  | JSON `{ status, timestamp }` API health.                     |
| `GET /ready`, `GET /readiness` | Deep readiness probe (DB, Redis/queues, workers, indexer); returns `503` until ready. |
| `GET /metrics`     | Prometheus metrics exposition.                               |

To probe these surfaces across environments, use the health smoke script (`npm run smoke`). See **[OPERATIONS.md](OPERATIONS.md#health-smoke-test)** for usage and the health-vs-readiness distinction.
