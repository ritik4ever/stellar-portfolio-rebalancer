# Maintainer Triage Guide

This guide documents the triage process for issues and pull requests (PRs) in the Stellar Portfolio Rebalancer repository. It's intended for maintainers and core contributors who review, label, and prioritize community contributions.

---

## 1. Issue triage workflow

### 1.1 Initial response target

| Priority | Response time | SLA |
| -------- | ------------- | --- |
| 🔴 Security | < 4 hours | Acknowledge and apply security label; follow disclosure process |
| 🟠 Bug | < 24 hours | Reproduce or request additional info |
| 🟢 Feature | < 48 hours | Confirm scope or request clarification |
| 🔵 Documentation | < 72 hours | Assign or self-assign |
| ⚪ Question | < 24 hours | Answer or redirect to Discord/Discussions |

### 1.2 Triage checklist

When a new issue is filed, the triager should:

- [ ] **Validate:** Is the issue well-formed? Does it use a template?
- [ ] **Reproduce:** For bugs, can you reproduce the described behavior?
- [ ] **Label:** Apply appropriate labels (see §3 below).
- [ ] **Prioritize:** Assign a priority label.
- [ ] **Assign:** If the issue is clear and actionable, assign a contributor or mark as `help wanted`.
- [ ] **Duplicate check:** Search for existing issues with similar keywords.
- [ ] **Close or redirect:** If the issue is out of scope, a question answered elsewhere, or a duplicate, close with a friendly explanation.

### 1.3 Issue lifecycle states

```
New → Triaged → [Accepted | Needs Info | Duplicate | Won't Fix]
                      ↓
              [Assigned | Help Wanted]
                      ↓
              In Progress (linked PR)
                      ↓
              Closed (PR merged)
```

---

## 2. Pull request triage workflow

### 2.1 PR review checklist

For every incoming PR, the maintainer should:

- [ ] **CI check:** Does the PR pass all CI checks (lint, test, build)?
- [ ] **Commit messages:** Are commit messages descriptive and conventional? (e.g., `feat:`, `fix:`, `docs:`)
- [ ] **Branch target:** Is the PR targeting the correct base branch (usually `main`)?
- [ ] **Scope:** Does the PR address a single concern? (Avoid scope-creep.)
- [ ] **Tests:** Does the PR include or update tests?
- [ ] **Documentation:** Does the PR update relevant docs (API.md, README, inline comments)?
- [ ] **Breaking changes:** Are any API or contract breaking changes documented?
- [ ] **Changelog:** Does the PR require a changelog entry?

### 2.2 Review states

```
Open → [Changes Requested | Approved | Dismissed]
          ↓
      [Merged | Closed]
```

### 2.3 Auto-merge criteria

PRs that meet all of the following can be auto-merged (after CI passes):

- No requested changes from previous reviews
- All CI checks pass
- No unstoppable merge conflicts
- At least one approval from a core maintainer
- Not a draft PR

### 2.4 Large PRs

If a PR touches more than 500 lines (excluding generated files, lockfiles, and test fixtures):

- Request the author to split into smaller PRs
- Or assign an additional reviewer for thorough evaluation
- Consider a "review by commit" strategy for complex changes

---

## 3. Label definitions

### Type labels

| Label | Description | Applies to |
| ----- | ----------- | ---------- |
| `bug` | Something doesn't work as expected | Issues, PRs |
| `enhancement` | New feature or improvement request | Issues, PRs |
| `docs` | Documentation improvements (code or project docs) | Issues, PRs |
| `devops` | CI/CD, Docker, deployment, infrastructure | Issues, PRs |
| `security` | Security-related issues or disclosures | Issues, PRs |
| `testing` | Test coverage, test infrastructure, test fixes | Issues, PRs |

### Priority labels

| Label | Description | Examples |
| ----- | ----------- | -------- |
| `priority:critical` | Blocker — must fix immediately | Fund loss, broken deployment, security breach |
| `priority:high` | Major feature or important fix | Broken core flow, data corruption |
| `priority:medium` | Standard feature or non-critical bug | Missing validation, edge case |
| `priority:low` | Nice-to-have enhancement | Cosmetic issues, optimizations, docs |

### Status labels

| Label | Description |
| ----- | ----------- |
| `help wanted` | Looking for a contributor to pick this up |
| `good first issue` | Good for new contributors; well-scoped and documented |
| `needs info` | Waiting for reporter to provide more details |
| `blocked` | Blocked on another issue, PR, or external dependency |
| `duplicate` | Already tracked in another issue |
| `wontfix` | Accepted but will not be fixed (with explanation in comments) |
| `Stellar Wave` | Part of the Stellar Wave bounty program |

### Area labels

| Label | Scope |
| ----- | ----- |
| `backend` | Node.js/Express API, middleware, database |
| `frontend` | React app, components, state management |
| `contracts` | Soroban smart contracts |
| `wallet` | Wallet integration (Freighter, xBull, etc.) |
| `api` | REST API endpoints |
| `database` | Data persistence, queries, migrations |
| `performance` | Speed, caching, optimization |
| `ux` | User experience, accessibility, design |

---

## 4. Release process

### 4.1 Versioning

This project follows **Semantic Versioning**:

- **MAJOR** — Breaking API changes or contract incompatibility
- **MINOR** — New features, non-breaking additions
- **PATCH** — Bug fixes, documentation, refactoring

### 4.2 Release checklist

- [ ] Create a release branch (`release/vX.Y.Z`) from `main`
- [ ] Ensure all CI passes on the release branch
- [ ] Update `CHANGELOG.md` with all changes since last release
- [ ] Update version in `package.json` and any other version references
- [ ] Tag the release commit (`git tag vX.Y.Z`)
- [ ] Push tag to GitHub (`git push --tags`)
- [ ] Create a GitHub Release with release notes
- [ ] Deploy to staging for final verification
- [ ] Deploy to production

---

## 5. Community management

### 5.1 Contributor recognition

- Thank contributors for their PRs in the review comments
- Add first-time contributors to the Hall of Fame (see `CONTRIBUTING.md`)
- Tag completed `good first issue` contributions for community highlights

### 5.2 Conflict resolution

If a discussion becomes contentious:

- Stay factual and constructive
- Reference code or documentation rather than opinions
- If consensus cannot be reached, escalate to a second maintainer
- For design decisions, use the ADR process (`docs/adr/`)

### 5.3 Closing stale issues

Issues with `needs info` label that haven't received a response from the reporter for **14 days** should be closed with:

> Closing due to inactivity. Please reopen with the requested information when you have it. Thanks!

---

## 6. Security disclosures

Follow the process documented in [`SECURITY.md`](../SECURITY.md):

1. Reporter sends vulnerability details to the security contact
2. Maintainer acknowledges within 24 hours
3. Fix is developed in a private fork
4. Patch is released and disclosed after 7 days (or sooner if actively exploited)

---

## 7. Useful commands

```bash
# Fetch and check out a contributor's PR for local testing
gh pr checkout <PR_NUMBER>

# List all open issues needing triage
gh issue list --label "needs triage"

# List PRs waiting for review
gh pr list --search "review:required"

# Approve and merge with a single command
gh pr merge <PR_NUMBER> --squash --subject "your commit message"
```

---

## References

- [Contributing Guide](../CONTRIBUTING.md)
- [Code of Conduct](../CODE_OF_CONDUCT.md)
- [Issue Templates](../../.github/ISSUE_TEMPLATE/)
- [ADR Process](./adr/)
