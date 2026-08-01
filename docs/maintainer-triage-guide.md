# Maintainer Triage Guide

This guide helps maintainers efficiently triage issues and pull requests in the Stellar Portfolio Rebalancer repository.

## Issue Triage

### Step 1: Validate

- **Is it a real issue?** Duplicates should be closed with a reference to the original.
- **Is it reproducible?** Ask for reproduction steps if not provided.
- **Is it complete?** Request missing information (logs, environment, version).

### Step 2: Label

| Label | When to Apply |
|-------|---------------|
| `bug` | Definite bug with reproduction |
| `enhancement` | Feature request or improvement |
| `docs` | Documentation-related |
| `question` | Needs clarification |
| `good first issue` | Suitable for new contributors |
| `Stellar Wave` | Part of the Stellar Wave Program |

### Step 3: Assign Priority

- **P0 (Critical):** Security vulnerabilities, broken core flow — respond within 24h
- **P1 (High):** Major feature, significant bug — respond within 72h
- **P2 (Medium):** Nice-to-have improvements, minor bugs — 1 week
- **P3 (Low):** Documentation, refactoring, cosmetic issues — no fixed timeline

### Step 4: Assign or Open for Community

- If you plan to work on it, assign yourself
- If it's a `good first issue`, leave it unassigned for community contributors
- For Stellar Wave issues, evaluate wave applications within 48 hours

## PR Triage

### Review Checklist

1. [ ] Does the PR title follow conventional commits? (`feat:`, `fix:`, `docs:`, etc.)
2. [ ] Does the PR reference the related issue?
3. [ ] Are changes scoped to a single concern?
4. [ ] Do all CI checks pass?
5. [ ] Are tests added or updated?
6. [ ] Is documentation updated if applicable?

### Merge Rules

- `docs` only changes: can merge after 1 approval
- Bug fixes: 1 approval + passing CI
- Features: 2 approvals + passing CI
- Breaking changes: requires issue discussion first

## Release Management

1. Merge feature PRs to `main`
2. Before release, create a `release/vX.Y.Z` branch
3. Update `CHANGELOG.md` with all changes
4. Tag the release commit
5. Publish release notes on GitHub Releases

## See Also

- [CONTRIBUTING.md](../CONTRIBUTING.md) — For contributors
- [SECURITY.md](../SECURITY.md) — Security disclosure process
