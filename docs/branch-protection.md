# Branch Protection Rules

## Main Branch
- Require pull request reviews (at least 1)
- Dismiss stale reviews when new commits are pushed
- Require status checks to pass
- Require branches to be up to date
- Require commit signing (GPG)
- Require linear history (no merge commits)
- Include administrators
- Restrict pushes to maintainers only

## Release Branches (`release/*`)
- Require pull request reviews (at least 1)
- Require status checks to pass
- Require linear history
- Restrict pushes to maintainers only

## Feature Branches (`feat/*`, `docs/*`, `fix/*`)
- No protection rules (flexible for development)
- Automatic deletion after merge (GitHub setting)

## Required Checks
The following CI checks must pass before merge:
- `ci / backend-test`
- `ci / frontend-test`
- `ci / contract-test`
- `ci / lint`
- `codeql / analyze`

## Enforcement
Branch protection rules are configured in GitHub Settings → Branches.
Changes to rules require admin approval and should be documented in ADRs.
