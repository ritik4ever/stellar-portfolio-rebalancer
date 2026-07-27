# Backlog Grooming & Issue Lifecycle Guide

This document outlines the standard process for maintaining the Stellar Portfolio Rebalancer backlog to ensure consistent issue batches, clear prioritization, and high-quality contributor workflows.

## 1. Issue Creation & Triage

### Reproducible Bug Reports
All bug reports must include:
- Environment details (OS, Node version, Rust/Soroban versions).
- Steps to reproduce.
- Expected behavior vs. actual behavior.
- Relevant logs or screenshots.

### Implementation-Ready Feature Requests
Feature requests must include:
- User story / Problem statement.
- Proposed solution.
- Acceptance criteria.
- Technical considerations or potential blockers.

### Triage Process
Maintainers review new issues weekly:
1. Ensure quality expectations (as per the templates).
2. Request clarification if necessary.
3. Apply appropriate labels.

## 2. Labeling Strategy

Use the following labels consistently:
- **Type:** `bug`, `enhancement`, `documentation`, `refactor`
- **Priority:** `p0-critical`, `p1-high`, `p2-medium`, `p3-low`
- **Status:** `triage`, `blocked`, `ready-for-dev`, `in-progress`
- **Domain:** `frontend`, `backend`, `contracts`, `devops`
- **Contributor:** `good first issue`, `help wanted`

## 3. Prioritization & Release Coordination

- Issues are grouped into GitHub Milestones corresponding to upcoming releases.
- Issues with `p0-critical` or `p1-high` take precedence.
- Review dependencies: If Issue A depends on Issue B, label Issue A as `blocked` and link Issue B in the description.

## 4. Acceptance Criteria & Testing Requirements

Before moving to `ready-for-dev`, issues must have clear, testable acceptance criteria:
- UI changes require visual verification or E2E tests.
- Backend/Contract changes require unit/integration test coverage.
- Documentation updates are required for user-facing or workflow changes.

## 5. Stale Issue Handling

To maintain a healthy backlog:
- Issues inactive for 60 days will be labeled `stale`.
- Stale issues inactive for another 14 days will be automatically closed.
- If a stale issue is still relevant, contributors can comment to remove the `stale` label.

## 6. PR Linking & Quality

- All PRs must link to an open issue using keywords (e.g., "Closes #123").
- PRs should not be merged if they do not fulfill all acceptance criteria of the linked issue.
- Reviewers will check for testing requirements and documentation updates during PR review.
