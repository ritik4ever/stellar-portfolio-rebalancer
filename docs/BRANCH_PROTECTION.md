# Branch Protection Rules & Required CI Checks

This document describes the branch protection rules enforced on the `main` branch, the CI checks that must pass before a pull request can be merged, and the expected merge workflow for contributors.

---

## Protected Branches

### `main`

The `main` branch is the production-ready release branch. All changes reach `main` through pull requests — direct pushes are not allowed.

| Rule                              | Setting  |
| --------------------------------- | -------- |
| Require pull request before merge | ✅ Yes   |
| Required approving reviews        | 1+       |
| Dismiss stale reviews on new push | ✅ Yes   |
| Require status checks to pass     | ✅ Yes   |
| Require branches to be up-to-date | ✅ Yes   |
| Require linear history            | ✅ Yes   |
| Include administrators            | ✅ Yes   |
| Allow force pushes                | ❌ No    |
| Allow deletions                   | ❌ No    |

### `develop` (if used)

The `develop` branch follows the same protection rules as `main`. Feature branches are merged into `develop` first, then promoted to `main` via a release PR.

---

## Required Status Checks

The following CI workflows are configured as **required status checks** on pull requests targeting `main`. A PR cannot be merged until every required check reports a passing status.

### Always-required checks (run on every PR)

| Check name                        | Workflow file                    | What it verifies                                                                 |
| --------------------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| `lint`                            | `lint.yml`                       | ESLint on frontend and backend code                                              |
| `commit-messages`                 | `lint.yml`                       | Every commit in the PR follows [Conventional Commits](https://conventionalcommits.org/) format |
| `build`                           | `build.yml`                      | Frontend and backend compile successfully; SBOMs are generated and attested      |
| `test`                            | `test.yml`                       | Frontend unit tests, backend tests with coverage, and Rust contract tests        |
| `coverage`                        | `coverage.yml`                   | Frontend and backend test coverage is collected and reported                      |
| `guard-generated-artifacts`       | `generated-artifact-guard.yml`   | No stale generated files (e.g. `openapi.json`) are committed; runtime artifacts are excluded |

### Path-scoped checks (run when relevant files change)

These checks are triggered only when their path filters match. GitHub treats them as required when they run and as automatically passing when skipped (path-filtered workflows use `paths:` triggers).

| Check name                                    | Workflow file                   | Trigger paths                                                                     | What it verifies                                                        |
| --------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `backend-tests` (shards 1–4)                  | `backend-tests.yml`             | `backend/**`                                                                      | Backend unit + integration tests across 4 parallel shards               |
| `backend-coverage` (merge + thresholds)        | `backend-tests.yml`             | `backend/**`                                                                      | Merges shard coverage blobs; enforces thresholds in `vitest.config.ts`  |
| `openapi-contract`                             | `backend-tests.yml`             | `backend/**`                                                                      | OpenAPI spec freshness and validation (`spec:check`, `api:validate`)    |
| `migration-dry-run` (SQLite + PostgreSQL)      | `backend-tests.yml`             | `backend/**`                                                                      | Database migrations apply cleanly on both engines                       |
| `frontend-tests`                               | `frontend-tests.yml`            | `frontend/**`                                                                     | Frontend unit tests with coverage                                       |
| `visual-regression`                            | `frontend-tests.yml`            | `frontend/**`                                                                     | Playwright visual snapshot comparison for critical screens              |
| `soroban-testnet-smoke`                        | `contract-smoke.yml`            | `contracts/**`                                                                    | Builds WASM, audits Rust deps, deploys and initializes on Stellar testnet |
| `test` (E2E)                                   | `e2e-tests.yml`                 | all files (targets `main`/`master` branches)                                      | Full Playwright E2E suite with PostgreSQL backend                       |
| `validate-env-examples`                        | `env-example-validation.yml`    | `.env.example`, `docs/ENVIRONMENT.md`, source files, validation script            | `.env.example` files stay in sync with source and docs                  |
| `audit-policy`                                 | `npm-audit-policy.yml`          | `package.json`, `package-lock.json`, audit baseline, `docs/CONTRIBUTING.md`       | npm dependency vulnerability counts stay at or below the reviewed baseline |
| `lighthouse`                                   | `lighthouse.yml`                | `frontend/**`, `.lighthouserc.json`                                               | Lighthouse CI performance, accessibility, and best-practice scores      |

### Post-merge checks (not blocking)

| Check name    | Workflow file | Trigger            | What it does                                    |
| ------------- | ------------- | ------------------ | ----------------------------------------------- |
| `deploy`      | `deploy.yml`  | `push` to `main`   | Builds Docker images and validates compose startup |
| `contract-deploy` | `contract-deploy.yml` | `push` to `main`, `release/**` PRs, manual dispatch | Promotes the Soroban contract through testnet, staging, and mainnet with environment approval gates |

### Scheduled checks (not blocking PRs)

| Check name               | Workflow file        | Schedule        | What it does                                                      |
| ------------------------ | -------------------- | --------------- | ----------------------------------------------------------------- |
| `soroban-testnet-smoke`  | `contract-smoke.yml` | Daily at 02:00 UTC | Ensures contracts still deploy successfully against live testnet  |

---

## What Contributors Should Know

### Before opening a PR

1. **Run tests locally** to catch failures early:
   ```bash
   cd backend && npm test && cd ../frontend && npm test
   ```

2. **Run the linter**:
   ```bash
   cd frontend && npm run lint
   cd ../backend && npm run lint
   ```

3. **Verify commit messages** follow Conventional Commits:
   ```bash
   scripts/check-commit-messages.sh
   ```

4. **Check env example sync** (if you changed environment variables):
   ```bash
   npm run validate:env-examples
   ```

5. **Check the audit baseline** (if you changed dependencies):
   ```bash
   npm run audit:policy
   ```

6. **Run the generated artifact guard** (if you changed OpenAPI sources):
   ```bash
   cd backend && npm run openapi:export && npm run api:validate
   ```

### After opening a PR

- All required checks appear in the **Checks** tab on the PR.
- If a check fails, click through to the workflow run for logs and error messages.
- Path-scoped checks only run when relevant files are modified — if you only changed `frontend/` code, backend checks won't appear.
- Fix failures locally, push again, and the checks re-run automatically.

### Merge requirements

A PR is mergeable when **all** of the following are true:

1. ✅ All required status checks pass (green)
2. ✅ At least one approving review from a maintainer
3. ✅ The branch is up-to-date with `main`
4. ✅ No unresolved review conversations

### Merge strategy

This repository uses **squash merges** to maintain a clean, linear commit history on `main`. The squash commit message should follow Conventional Commits format.

---

## Common CI Failure Scenarios

| Failure                                      | Likely cause                                                       | Resolution                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `commit-messages` fails                      | One or more commits don't follow Conventional Commits format       | Amend or interactive-rebase to fix: `git rebase -i origin/main`                                       |
| `lint` fails                                 | ESLint violations in frontend or backend                           | Run `npm run lint` locally in the affected workspace and fix reported issues                          |
| `build` fails                                | TypeScript compilation errors or missing dependencies              | Run `npm run build` in the failing workspace; check for type errors                                   |
| `test` fails                                 | A unit or integration test is broken                               | Run `npm test` locally; check test output for assertion failures                                      |
| `backend-coverage` fails                     | Coverage dropped below thresholds in `backend/vitest.config.ts`    | Add tests for uncovered code paths or adjust thresholds with maintainer approval                      |
| `guard-generated-artifacts` fails            | Committed `openapi.json` is stale                                  | Run `cd backend && npm run openapi:export` and commit the updated spec                                |
| `validate-env-examples` fails                | `.env.example` doesn't match source `process.env.*` references     | Run `npm run validate:env-examples` and add missing variables to `.env.example`                       |
| `audit-policy` fails                         | New dependency introduced a known vulnerability above baseline     | Run `npm run audit:policy` to see details; fix the vulnerability or update baseline with maintainer OK |
| `migration-dry-run` fails                    | A migration file has a syntax error or conflict                    | Run `npm run db:migrate -- --dry-run` locally against both SQLite and PostgreSQL                      |
| `visual-regression` fails                    | UI screenshot doesn't match baseline                               | Review diffs in the uploaded Playwright artifact; update baselines if the change is intentional        |
| `soroban-testnet-smoke` fails                | Contract doesn't build or deploy on testnet                        | Check Rust build errors; verify testnet RPC is reachable; check `STELLAR_TESTNET_SECRET_KEY` secret   |
| `lighthouse` fails                           | Performance or accessibility scores dropped below thresholds       | Check `.lighthouserc.json` for thresholds; optimize the flagged areas                                 |

---

## Configuring Branch Protection (Maintainers)

Branch protection rules are configured in **Settings → Branches → Branch protection rules** on GitHub.

### Recommended setup for `main`

1. Navigate to **Settings → Branches** in the repository.
2. Click **Add rule** (or edit the existing `main` rule).
3. Set **Branch name pattern** to `main`.
4. Enable:
   - ✅ **Require a pull request before merging** (at least 1 approval)
   - ✅ **Dismiss stale pull request approvals when new commits are pushed**
   - ✅ **Require status checks to pass before merging**
   - ✅ **Require branches to be up to date before merging**
   - ✅ **Require linear history**
   - ✅ **Do not allow bypassing the above settings** (include administrators)
5. Under **Status checks that are required**, add:
   - `lint`
   - `commit-messages`
   - `build`
   - `test`
   - `coverage`
   - `guard-generated-artifacts`
6. Save the rule.

> **Note:** Path-scoped checks (`backend-tests`, `frontend-tests`, `lighthouse`, etc.) should **not** be added to the required list directly, because they are skipped when their path filters don't match. GitHub would block the PR if a required check never starts. Instead, rely on the always-running `test` and `build` workflows for baseline coverage, and use path-scoped checks as additional gates when they do run.

### Adding a new required check

When adding a new CI workflow that should block merges:

1. Create the workflow YAML in `.github/workflows/`.
2. Ensure it triggers on `pull_request` (with or without `paths:` filters).
3. If it should be **always-required**, add its job name to the branch protection required checks list.
4. If it is **path-scoped**, do not add it to the required list — it will run and report status only when relevant files change.
5. Update this document to include the new check in the appropriate table above.
6. Open a PR to validate the workflow runs correctly.

---

## Further Reading

- [Contributor Setup Guide](CONTRIBUTING.md) — Full local development setup
- [Maintainer Triage Guide](TRIAGE.md) — Issue and PR triage procedures
- [Operations Handbook](OPERATIONS.md) — Redis, workers, health checks
- [Release Checklist](RELEASE_CHECKLIST.md) — Steps for cutting a release
