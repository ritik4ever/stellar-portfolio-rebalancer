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

- **Interactive docs (Swagger UI):** `http://localhost:3001/api-docs` (backend port from `PORT`, default `3001`)
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

## CI Validation

The `api:validate` script (`backend/scripts/validate-api-docs.ts`) checks that `backend/openapi.json` is in sync with `backend/src/openapi/spec.ts`. If you update `spec.ts` without re-exporting, the CI check will fail with:

```
❌ openapi.json is out of sync with spec.ts. Run "npm run openapi:export" to refresh.
```

Always run `npm run openapi:export` before committing spec changes.
