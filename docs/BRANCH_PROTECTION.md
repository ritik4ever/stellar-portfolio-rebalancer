# Branch Protection Rules

This document describes the branch protection rules and required checks for the Stellar Portfolio Rebalancer repository.

## Main Branch Protection

The `main` branch is protected with the following rules:

### Required Checks

Before a pull request can be merged to `main`, the following CI checks must pass:

| Check | Workflow | Description |
|-------|----------|-------------|
| Backend Tests | `backend-tests.yml` | Unit and integration tests for the backend |
| Frontend Tests | `frontend-tests.yml` | Unit tests for the frontend components |
| Lint | `lint.yml` | ESLint and Prettier formatting checks |
| Build | `build.yml` | TypeScript compilation and production build |
| Contract Smoke | `contract-smoke.yml` | Soroban contract compilation and minimal tests |
| E2E Tests | `e2e-tests.yml` | Playwright end-to-end tests |
| Coverage | `coverage.yml` | Test coverage thresholds (80% minimum) |
| Lighthouse | `lighthouse.yml` | Frontend performance budget |
| Env Example | `env-example-validation.yml` | Environment variable configuration check |

### Merge Requirements

1. At least **one** approving review from a maintainer
2. All required checks must pass
3. Branch must be up to date with `main`
4. Commit messages must follow conventional commits format

### Exceptions

- **Urgent hotfixes** may bypass checks with maintainer approval
- **Documentation-only PRs** do not require E2E tests to pass

## Branch Naming Convention

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feat/` | New features | `feat/add-price-alerts` |
| `fix/` | Bug fixes | `fix/rebalance-calculation` |
| `docs/` | Documentation | `docs/api-error-codes` |
| `chore/` | Maintenance tasks | `chore/update-dependencies` |
| `devops/` | CI/CD and tooling | `devops/add-docker-compose` |
| `test/` | Test additions | `test/edge-case-coverage` |

## Release Process

1. All PRs merged to `main` trigger the release workflow
2. Release-please creates/updates a release PR
3. On merge, a GitHub release is created and Docker image published
4. Contract WASM binary is attached to the release

## Required Checks Configuration

To modify required checks:

1. Go to Settings → Branches → Branch protection rules
2. Click "Edit" on the `main` rule
3. Update the "Require status checks" section
4. Save changes

## Monitoring

- [GitHub Actions dashboard](https://github.com/ritik4ever/stellar-portfolio-rebalancer/actions)
- Failed builds send notifications to the #ci-failures Slack channel
