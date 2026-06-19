# API curl recipes

This folder contains copy-paste `curl` examples for the most common backend API workflows. Use these recipes to validate the API locally, test the backend while developing, and share reproducible integration steps with contributors.

- Base URL: `http://localhost:3001`
- Canonical API namespace: `/api/v1`
- Legacy compatibility namespace: `/api/*` (deprecated)
- If JWT auth is enabled, add `-H "Authorization: Bearer <token>"`
- For idempotent writes, add `-H "Idempotency-Key: <uuid>"`

## Recipes

- [Portfolio workflow](portfolio-quickstart.md)
- [Notifications workflow](notifications.md)
- [Prices and health checks](prices-health.md)

## Why this folder exists

These recipes are intended to make common API tasks easy to reproduce without reading source code. They are especially useful for:

- new contributors validating the backend locally
- integrators testing API behavior before writing client code
- reviewers verifying docs against implementation

## Maintenance

Keep these examples in sync with `backend/src/api` and the OpenAPI spec in `backend/src/openapi/spec.ts`.

When the backend API changes, update the recipes and validate the docs:

```bash
cd backend
npm run api:validate
```
