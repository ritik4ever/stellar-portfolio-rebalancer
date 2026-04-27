# Contributing to Stellar Portfolio Rebalancer

Thanks for your interest in contributing!

The full contributor setup guide is at **[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)**.

It covers:

- Minimum local setup (backend + frontend)
- Optional services: PostgreSQL, Redis, SMTP
- Database migrations (PostgreSQL and SQLite paths)
- Running backend and frontend tests
- OpenAPI maintenance (`cd backend && npm run openapi:export` and `npm run api:validate` — see [backend/docs/openapi.md](backend/docs/openapi.md))
- Queue worker setup and expectations
- Frontend E2E tests with Playwright
- Contract build and deploy steps
- Common setup failures and fixes
- Changelog workflow (`npm run changelog:update`)

For a quick overview of the API contract see [API.md](API.md). Background services and troubleshooting are covered in [docs/OPERATIONS.md](docs/OPERATIONS.md). Feature flags are summarized in [docs/FEATURE_FLAGS.md](docs/FEATURE_FLAGS.md), and Soroban event shapes for the indexer are in [docs/CONTRACT_EVENTS.md](docs/CONTRACT_EVENTS.md).

## Workflow

1. Fork the repository and create a feature branch: `git checkout -b feature/your-feature`
2. Follow the setup guide in [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)
3. Make your changes and ensure all tests pass: `cd backend && npm test && cd ../frontend && npm test`
4. Open a pull request targeting `main`

## Changelog Updates

When your changes should be visible to users or contributors, update the changelog before opening a PR:

1. Run `npm run changelog:update` from the repository root.
2. Review `CHANGELOG.md` and adjust wording/grouping if needed.
3. Keep newest entries in `## [Unreleased]` until release cut.
