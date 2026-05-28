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

1. **Automatic generation**: Run `npm run changelog:update` from the repository root to generate entries from conventional commits.
2. **Manual review**: Review `CHANGELOG.md` and adjust wording/grouping if needed.
3. **Unreleased section**: Keep newest entries in `## [Unreleased]` until release cut.
4. **Commit format**: Use [conventional commits](https://conventionalcommits.org/) for automatic changelog generation:
   - `feat(api): add new endpoint` → Added section
   - `fix(auth): resolve token issue` → Fixed section
   - `docs: update examples` → Not included (docs-only)
   - `BREAKING CHANGE:` in footer → Prominently documented

**Release workflow**: See [CHANGELOG.md](CHANGELOG.md#release-notes-workflow) for the complete release notes process and maintainer responsibilities.

## Pre-commit Hooks (Optional)

You can enable pre-commit hooks for faster feedback during development:

```bash
# Enable hooks
npx husky install

# Run lint-staged on all staged files
npx lint-staged
```

Hooks run ESLint and Prettier on staged `.ts`, `.tsx`, `.js`, `.jsx` files.

To skip hooks for a commit (emergency only):
```bash
git commit --no-verify -m "your message"
```
