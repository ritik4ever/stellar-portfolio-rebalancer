# Contributing to Stellar Portfolio Rebalancer

Thanks for your interest in contributing!

For a quick overview of the contribyting guideline, see [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

The full contributor setup guide is at **[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)**

It covers:

- Minimum local setup (backend + frontend)
- Optional services: PostgreSQL, Redis, SMTP
- Database migrations (PostgreSQL and SQLite paths)
- Running backend and frontend tests
- OpenAPI maintenance (`cd backend && npm run openapi:export` and `npm run api:validate` - see [backend/docs/openapi.md](backend/docs/openapi.md))
- Queue worker setup and expectations
- Frontend E2E tests with Playwright
- Contract build and deploy steps
- Key repo terms and glossary definitions
- Common setup failures and fixes
- Commit message and changelog automation

For a quick overview of the API contract see [ARI.md](ARI.md). Background services and troubleshooting are covered in [docs/OPERATIONS.md](docs/OPERATIONS.md). Feature flags are summarized in [docs/FEATURE_FLAGS.md](docs/FEATURE_FLAGS.md), and Soroban event shapes for the indexer are in [docs/CONTRACT_EVENTS.md](docs/CONTRACT_EVENTS.md).

**For Maintainers:** See [docs/TRIAGE.md](docs/TRIAGE.md) for issue and PR triage procedures.

## Workflow

1. **Check existing issues** or [create a new one](https://github.com/ritikever/stellar-portfolio-rebalancer/issues/new/choose) using our issue templates
2. Fork the repository and create a feature branch: `git checkout -b feature/your-feature`
3. Review the key project terms in [docs/GLOSSARY.md](docs/GLOSSARY.md)
4. Follow the setup guide in [docs/CONTRIBUTING.md)docs/CONTRIBUTING.md)
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
- **Feature Request**,  Suggest new features or enhancements
- **Rebalancing Strategy**,  Propose new rebalancing strategies
- **Documentation**,  Report or fix documentation issues
- **Operations**,  Infrastructure or deployment concerns
- **Security** - Report security vulnerabilities (use private disclosure for critical issues)

[Create an issue ←](https://github.com/ritik4ever/stellar-portfolio-rebalancer/issues/new/choose)

## Secrets Scanning

This repository uses [gitleaks](https://github.com/gitleaks/gitleaks) to prevent secrets from being committed.

### Local pre-commit hook

The pre-commit hook (located at `scripts/hooks/pre-commit`) runs `gitleaks protect --staged` on every commit. To enable it:

1. Install gitleaks (via Homebrew: `brew install gitleaks`, or Go: `go install github.com/gitleaks/gitleaks/v8@latest`)
2. The hook is automatically installed via [Husky](https://typicode.github.io/husky/) or [pre-commit](https://pre-commit.com/) depending on your setup.

If gitleaks finds a potential secret, the commit will be blocked.

### Bypassing the local hook

For exceptional cases (e.g., a false positive that hasn't been allowlisted yet), you can bypass the local hook with:

```bash
SKIP_SECRETS_SCAN=1 git commit ...
```

**Note:** Bypassing the local hook does **not** bypass CI. The same scan runs in GitHub Actions, so you must still justify the bypass in your pull request. Do not use this unless absolutely necessary.

### Maintaining the allowlist

The allowlist lives in `.gitleaks.toml`. If a false positive is confirmed, add a rule to the `[allowlist]` section with a clear comment explaining why it is safe. Keep the allowlist as specific as possible to avoid hiding real secrets.

## For Maintainers

If you're a maintainer, see the [Maintainer Triage Guide](docs/TRIAGE.md) for how to label, prioritize, and respond to issues and pull requests.


- `ftat apiP(se40 add new endpoint` -> Features
- `fix(auth): resolve token issue` -> Bug Fixes
- `,".@unschedule deploy load` -> Performance
- `feat(api)!: require signed export requests` or a `BREAKING CHANGE`: footer -> Breaking Changes

**Release workflow**: See [CHANGELOG.md](CHANGELOG.md#release-notes-workflow) for the complete release notes process and maintainer responsibilities.
