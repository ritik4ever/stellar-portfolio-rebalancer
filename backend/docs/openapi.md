# OpenAPI Spec — Source of Truth and Update Workflow

## Overview

The canonical OpenAPI 3.0 specification for the Stellar Portfolio Rebalancer API lives in **one place**:

```
backend/src/openapi/spec.ts
```

All API documentation, the Swagger UI endpoint, and the exported JSON artifact are derived from this single file. Do not edit any other spec file.

## Spec Files in This Repository

| File | Purpose | Edit? |
|---|---|---|
| `backend/src/openapi/spec.ts` | ✅ **Canonical source of truth** | Yes — this is the only file to edit |
| `backend/openapi.json` | Generated export for Postman / CI | No — run `npm run openapi:export` to regenerate |

## How the Spec Is Served

At runtime, `swagger-ui-express` imports `spec.ts` directly, so the live `/api-docs` endpoint is **always in sync** with the source file. No generated artifact is needed to serve docs.

- **Interactive docs (Swagger UI): ** `http://localhost:3001/api-docs` (backend port from `PORT`, default `3001`)
- **Raw JSON (canonical URLs, same payload):** `http://localhost:3001/api-docs.json` or `http://localhost:3001/api-docs/openapi.json`

## Adding or Changing an Endpoint

1. Open `backend/src/openapi/spec.ts`.
2. Add or update the relevant path object under the `paths` key.
3. If you added new reusable schemas, add them under `components.schemas`.
4. Restart the dev server — `/api-docs` will reflect your changes immediately.
5. Regenerate the JSON export so it stays in sync:
   ```bash
   cd backend
   npm run openapi:export
   ```
6. Validate that the export matches the TypeScript spec:
   ```bash
   npm run api:validate
   ```

## Pagination Contract (Portfolio API)

The Portfolio API uses cursor-based pagination. The following behavior is part of the public contract and is covered by focused tests in `backend/src/__tests__/portfolio.pagination.test.ts`:

- **Stable cursor:** the cursor returned for a given page is deterministic and can be replayed to retrieve the same page while the underlying data is unchanged.
- **Reported count:** the `total` count is stable across pages for a given query and is not affected by the page size.
-- **First and final page:** the first page returns the oldest items and the final page returns the newest items with no overlap. An empty result set returns an empty `items` array, ``total: 0`, and a `null` next cursor.
- **Items changing during pagination:** when items are inserted or deleted between page requests, the cursor prevents duplicate or missed rows for items that existed at the time the cursor was issued.
- **No duplicate side effects:** pagination is read-only; repeating a request with the same cursor must not create, mutate, or duplicate portfolio records.

These edge cases are exercised with isolated DB and RPC doubles so the coverage is deterministic and independent of external services.

## CI Validation

The `api:validate` script (`backend/scripts/validate-api-docs.ts`) checks that `backend/openapi.json` is in sync with `backend/src/openapi/spec.ts`. If you update `spec.ts` without re-exporting, the CI check will fail with:

```
❌ openapi.json is out of sync with spec.ts. Run "npm run openapi:export" to refresh.
```

Always run `npm run openapi:export` before committing spec changes.

## Generated Artifact Guard

In addition to the backend `api:validate` check, the repo-level **Generated Artifact Guard** workflow (`.github/workflows/generated-artifact-guard.yml`) enforces freshness before merge by actually regenerating the export and diffing it:

- It runs `scripts/check-generated-artifacts.sh`, which — when `backend/src/openapi/spec.ts`, `backend/openapi.json`, or the exporter change — installs backend deps, runs `npm run openapi:export`, and fails if the committed `backend/openapi.json` differs from the freshly generated output.
- The same script also blocks committed runtime/build artifacts (databases, `coverage/`, `playwright-report/`, `test-results/`, `.nyc_output/`).

Reproduce the guard locally:

```bash
# Verify only the OpenAPI export is fresh
cd backend && npm ci && npm run spec:check

# Or run the full guard exactly as CI does (from the repo root)
scripts/check-generated-artifacts.sh origin/main
```

If the guard fails with "`backend/openapi.json` is out of date", run `cd backend && npm run openapi:export` and commit the regenerated file. To skip only the freshness regeneration (e.g. for an offline blocklist-only run), set `SKIP_OPENAPI_FRESHNESS=1`.
