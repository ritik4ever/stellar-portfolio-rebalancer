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
- Key repo terms and glossary definitions
- Common setup failures and fixes
- Changelog workflow (`npm run changelog:update`)
- Architecture Decision Records (ADRs) at [docs/adr/](docs/adr/README.md)


For a quick overview of the API contract see [API.md](API.md). Background services and troubleshooting are covered in [docs/OPERATIONS.md](docs/OPERATIONS.md). Feature flags are summarized in [docs/FEATURE_FLAGS.md](docs/FEATURE_FLAGS.md), and Soroban event shapes for the indexer are in [docs/CONTRACT_EVENTS.md](docs/CONTRACT_EVENTS.md).

**For Maintainers:** See [docs/TRIAGE.md](docs/TRIAGE.md) for issue and PR triage procedures.

## Workflow

1. **Check existing issues** or [create a new one](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/new/choose) using our issue templates
2. Fork the repository and create a feature branch: `git checkout -b feature/your-feature`
3. Review the key project terms in [docs/GLOSSARY.md](docs/GLOSSARY.md)
4. Follow the setup guide in [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)
5. Make your changes and ensure all tests pass: `cd backend && npm test && cd ../frontend && npm test`
6. Open a pull request targeting `main` (reference the issue with "Closes #123")

## Terminology

Read [docs/GLOSSARY.md](docs/GLOSSARY.md) early in your onboarding process. It explains the language used by the backend, frontend, and Soroban contract interface, including:

- `Portfolio` / `portfolio_id`
- `Target allocation`, `Rebalance threshold`, `Slippage tolerance`
- `Reflector oracle`
- `Emergency stop` and `Cooldown period`

This helps contributors complete the workflow without needing to read source code first.

> **Before you open a PR**, review the [Branch Protection & Required Checks](docs/BRANCH_PROTECTION.md) guide to understand which CI checks must pass before your PR can be merged.

## Issue Templates

We provide templates for common contribution types:

- **Bug Report** - Report unexpected behavior or errors
- **Feature Request** - Suggest new features or enhancements
- **Rebalancing Strategy** - Propose new rebalancing strategies
- **Documentation** - Report or fix documentation issues
- **Operations** - Infrastructure or deployment concerns
- **Security** - Report security vulnerabilities (use private disclosure for critical issues)

[Create an issue →](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/new/choose)

## For Maintainers

If you're a maintainer, see the [Maintainer Triage Guide](docs/TRIAGE.md) for how to label, prioritize, and respond to issues and pull requests.

## Dependency Management

### Renovate Configuration

Dependency updates are managed automatically using [Renovate](https://www.renovatebot.com/). The configuration is in [renovate.json](renovate.json) and covers:

- **npm packages** (root, frontend, backend)
- **Cargo dependencies** (contracts)

### Update Schedule & Grouping

- **Patch updates**: Grouped into a single weekly batch PR (Monday at 3am UTC)
- **Minor updates**: Separate PRs (one per package)
- **Major updates**: Separate PRs (one per package, high priority review)
- **Node.js versions**: Major and minor only; patch versions handled separately
- **Rust toolchain**: Managed via rust-toolchain configuration

### Renovate PR Workflow

1. Renovate creates PRs automatically for dependency updates (no manual trigger needed)
2. CI checks are **required** before merge — all tests and build checks must pass
3. PRs are labeled and grouped by dependency type for easy review
4. Security vulnerabilities are prioritized and flagged

### Handling Renovate PRs

When reviewing Renovate PRs:
- Check the changelog and breaking changes for major version bumps
- Run tests locally if concerned about compatibility
- Comment on the PR if issues are found
- PRs are configured with auto-merge disabled to require explicit approval

Maintainers can also merge PRs directly if CI passes and the update is safe.

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
