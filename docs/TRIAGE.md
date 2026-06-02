# Maintainer Triage Guide

This guide documents how maintainers label, prioritize, respond to, and close issues and pull requests in this repository.

---

## Table of Contents

- [Triage Workflow Overview](#triage-workflow-overview)
- [Issue Triage](#issue-triage)
- [Pull Request Triage](#pull-request-triage)
- [Label System](#label-system)
- [Priority Levels](#priority-levels)
- [Response Templates](#response-templates)
- [Closing Issues and PRs](#closing-issues-and-prs)
- [Escalation Process](#escalation-process)

---

## Triage Workflow Overview

**Goal:** Ensure every issue and PR receives timely attention, clear labeling, and appropriate prioritization.

**Triage Frequency:** Daily for new issues/PRs, weekly review of stale items.

**Triage Responsibilities:**
- Any maintainer can perform initial triage
- Complex issues may require domain expert review
- Security issues follow special handling (see [Security Triage](#security-triage))

---

## Issue Triage

### Step 1: Initial Assessment (within 48 hours)

When a new issue arrives:

1. **Read the issue thoroughly**
   - Understand the problem or request
   - Check if the template was followed
   - Verify all required information is present

2. **Add `needs-triage` label** (if not already present)
   - This label is automatically added by most issue templates

3. **Validate completeness**
   - If information is missing, use the [Missing Information](#missing-information) template
   - Add `needs-info` label and wait for response
   - Set a 7-day reminder to follow up

### Step 2: Categorization

Add appropriate **type labels**:

| Label | When to Use |
|-------|-------------|
| `bug` | Unexpected behavior or errors |
| `enhancement` | New features or improvements |
| `documentation` | Docs issues or improvements |
| `operations` | Deployment, infrastructure, performance |
| `security` | Security vulnerabilities or hardening |
| `rebalancing-strategy` | Specific to rebalancing strategy features |

Add **component labels**:

| Label | Component |
|-------|-----------|
| `frontend` | React UI, components, styling |
| `backend` | Node.js API, services, database |
| `contract` | Soroban smart contracts |
| `deployment` | Docker, infrastructure, CI/CD |
| `testing` | Test infrastructure or coverage |

### Step 3: Priority Assignment

Assign a **priority label** based on impact and urgency:

| Priority | Criteria | Response Time |
|----------|----------|---------------|
| `P0-critical` | Service down, data loss, security breach | Immediate (< 4 hours) |
| `P1-high` | Major functionality broken, significant user impact | 1-2 days |
| `P2-medium` | Minor bugs, moderate enhancements | 1 week |
| `P3-low` | Nice-to-haves, optimizations, minor docs | 2-4 weeks |

**Priority Decision Matrix:**

```
High Impact + Urgent = P0 (Critical)
High Impact + Not Urgent = P1 (High)
Low Impact + Urgent = P2 (Medium)
Low Impact + Not Urgent = P3 (Low)
```

### Step 4: Additional Labels

Add **status labels** as needed:

- `good-first-issue` - Suitable for new contributors
- `help-wanted` - Community contributions welcome
- `blocked` - Waiting on external dependency or decision
- `duplicate` - Duplicate of existing issue (link to original)
- `wontfix` - Valid issue but won't be addressed (explain why)
- `needs-discussion` - Requires team or community input

### Step 5: Assignment and Milestones

- **Assign to maintainer** if someone is actively working on it
- **Add to milestone** if it's planned for a specific release
- **Add to project board** if using GitHub Projects for tracking

### Step 6: Initial Response

Respond to the issue within 48 hours:

- Thank the reporter
- Confirm the issue is understood
- Provide initial assessment (priority, timeline, or need for more info)
- Set expectations for next steps

Use [Response Templates](#response-templates) for common scenarios.

### Step 7: Remove `needs-triage`

Once categorized, prioritized, and responded to, remove the `needs-triage` label.

---

## Pull Request Triage

### Step 1: Initial Review (within 24 hours)

When a new PR arrives:

1. **Check CI status**
   - The `pr-issue-trail` check **automatically enforces** that every PR either
     links a GitHub issue or provides an explicit `No issue: <rationale>`.
   - If this check failed, ask the author to edit the PR description in the
     GitHub UI (no new commit required). The check re-runs automatically on save.
   - If a maintainer override is needed for a hotfix or exceptional case,
     apply the **`skip-issue-check`** label. The check will be skipped on the
     next run. Only contributors with write access can apply labels.
   - If the `No issue:` path was used, **review the quality of the rationale**.
     The CI check validates the keyword's *presence*, not its *adequacy* — this
     judgment remains a human responsibility.

2. **Check PR quality**
   - Is the description clear and complete?
   - Are tests included?
   - Does CI pass (build, lint, tests)?

3. **Add labels**
   - Type: `bug`, `enhancement`, `documentation`, etc.
   - Component: `frontend`, `backend`, `contract`, etc.
   - Size: `size/XS`, `size/S`, `size/M`, `size/L`, `size/XL`

### Step 2: Size Estimation

Add a **size label** based on lines changed and complexity:

| Label | Lines Changed | Complexity |
|-------|---------------|------------|
| `size/XS` | < 10 | Trivial (typo, config) |
| `size/S` | 10-50 | Simple (single file, clear change) |
| `size/M` | 50-200 | Moderate (multiple files, some complexity) |
| `size/L` | 200-500 | Large (significant feature or refactor) |
| `size/XL` | > 500 | Extra large (major feature, consider splitting) |

### Step 3: Review Assignment

- **Assign reviewers** based on component expertise
- **Request changes** if PR doesn't meet quality standards
- **Approve** if changes look good (but see [Merge Criteria](#merge-criteria))

### Step 4: Merge Criteria

A PR can be merged when:

- [ ] At least one maintainer approval
- [ ] All CI checks pass (tests, linting, build)
- [ ] No unresolved review comments
- [ ] Changelog updated (if user-facing change)
- [ ] Documentation updated (if needed)
- [ ] No merge conflicts

**For critical changes** (security, breaking changes, contract updates):
- [ ] Two maintainer approvals required
- [ ] Additional testing in staging environment
- [ ] Deployment plan documented

### Step 5: Merge and Close

- Use **squash and merge** for feature branches (clean history)
- Use **merge commit** for release branches (preserve history)
- Delete the branch after merging
- Ensure linked issues are closed automatically (use "Closes #123" in PR description)

---

## Label System

### Type Labels

| Label | Color | Description |
|-------|-------|-------------|
| `bug` | Red | Something isn't working |
| `enhancement` | Blue | New feature or request |
| `documentation` | Light blue | Documentation improvements |
| `operations` | Orange | Infrastructure and deployment |
| `security` | Dark red | Security issues |
| `rebalancing-strategy` | Purple | Rebalancing strategy features |

### Component Labels

| Label | Color | Description |
|-------|-------|-------------|
| `frontend` | Cyan | React frontend |
| `backend` | Green | Node.js backend |
| `contract` | Yellow | Soroban smart contracts |
| `deployment` | Brown | Docker and infrastructure |
| `testing` | Pink | Test infrastructure |

### Priority Labels

| Label | Color | Description |
|-------|-------|-------------|
| `P0-critical` | Dark red | Immediate attention required |
| `P1-high` | Red | High priority |
| `P2-medium` | Orange | Medium priority |
| `P3-low` | Yellow | Low priority |

### Status Labels

| Label | Color | Description |
|-------|-------|-------------|
| `needs-triage` | Gray | Awaiting initial triage |
| `needs-info` | Gray | Waiting for more information |
| `good-first-issue` | Green | Good for newcomers |
| `help-wanted` | Green | Community contributions welcome |
| `blocked` | Red | Blocked by external dependency |
| `duplicate` | Gray | Duplicate of another issue |
| `wontfix` | Gray | Valid but won't be fixed |
| `needs-discussion` | Purple | Requires team discussion |

### Size Labels (PRs only)

| Label | Color | Description |
|-------|-------|-------------|
| `size/XS` | Light green | < 10 lines |
| `size/S` | Green | 10-50 lines |
| `size/M` | Yellow | 50-200 lines |
| `size/L` | Orange | 200-500 lines |
| `size/XL` | Red | > 500 lines |

---

## Priority Levels

### P0: Critical

**Criteria:**
- Production service is down or severely degraded
- Data loss or corruption
- Critical security vulnerability
- Complete loss of core functionality

**Response:**
- Immediate acknowledgment (< 4 hours)
- All hands on deck if needed
- Hotfix process may bypass normal review
- Post-incident review required

**Examples:**
- Backend API returning 500 errors for all requests
- Smart contract vulnerability allowing fund theft
- Database corruption preventing all operations

### P1: High

**Criteria:**
- Major functionality broken for significant user segment
- High-impact bug affecting core features
- Security issue with moderate risk
- Blocking issue for upcoming release

**Response:**
- Acknowledge within 24 hours
- Fix within 1-2 days
- May require expedited review

**Examples:**
- Wallet connection failing for Freighter users
- Rebalancing execution failing intermittently
- API endpoint returning incorrect data

### P2: Medium

**Criteria:**
- Minor bugs with workarounds
- Moderate feature enhancements
- Non-blocking issues
- Documentation gaps

**Response:**
- Acknowledge within 48 hours
- Fix within 1 week
- Normal review process

**Examples:**
- UI layout issue on mobile
- Missing API documentation
- Performance optimization opportunity

### P3: Low

**Criteria:**
- Nice-to-have features
- Minor optimizations
- Cosmetic issues
- Low-impact documentation improvements

**Response:**
- Acknowledge within 1 week
- Fix when capacity allows (2-4 weeks)
- Good candidates for community contributions

**Examples:**
- Typo in documentation
- UI polish suggestions
- Code refactoring for maintainability

---

## Response Templates

### Missing Information

```markdown
Thanks for reporting this! To help us investigate, could you please provide:

- [ ] [Specific information needed]
- [ ] [Additional context needed]

I've added the `needs-info` label. We'll follow up once we have these details.
```

### Bug Confirmed

```markdown
Thanks for the detailed report! I've confirmed this is a bug and labeled it as `P[X]-[priority]`.

**Next steps:**
- [Immediate action or investigation plan]
- Expected timeline: [timeframe]

We'll keep you updated on progress.
```

### Feature Request Acknowledged

```markdown
Thanks for the suggestion! This is an interesting idea.

**Initial assessment:**
- Aligns with project goals: [Yes/No/Partially]
- Complexity: [Low/Medium/High]
- Priority: [P2/P3]

We've added this to our backlog. Community contributions are welcome if you'd like to work on this!

See [CONTRIBUTING.md](../CONTRIBUTING.md) for setup instructions.
```

### Needs Discussion

```markdown
Thanks for raising this! This requires some team discussion to determine the best approach.

**Discussion points:**
- [Key question 1]
- [Key question 2]

I've added the `needs-discussion` label. We'll update this issue once we've reached a decision.
```

### Duplicate Issue

```markdown
Thanks for reporting! This is a duplicate of #[issue-number].

I'm closing this in favor of the original issue. Please follow #[issue-number] for updates and feel free to add any additional context there.
```

### Won't Fix

```markdown
Thanks for the suggestion. After review, we've decided not to pursue this because:

- [Reason 1]
- [Reason 2]

We appreciate your input! If you have other ideas or concerns, please feel free to open a new issue.
```

### Stale Issue

```markdown
This issue has been inactive for [X] days. 

If this is still relevant, please provide an update. Otherwise, we'll close this in 7 days to keep our issue tracker focused.

To reopen later, just comment and we'll take another look.
```

---

## Closing Issues and PRs

### When to Close Issues

**Close immediately:**
- Duplicate issues (link to original)
- Spam or off-topic
- Already fixed in latest version
- Won't fix (with explanation)

**Close after resolution:**
- Bug is fixed and merged
- Feature is implemented and merged
- Question is answered and confirmed

**Close after inactivity:**
- No response to `needs-info` after 14 days
- Stale issues with no activity for 60 days (after warning)

### When to Close PRs

**Close immediately:**
- Spam or malicious
- Violates code of conduct
- Duplicate of existing PR

**Close after review:**
- Author abandoned (no response for 30 days after review)
- Superseded by another PR
- Approach rejected (with explanation)

**Merge and close:**
- Meets all merge criteria
- Approved by required reviewers
- CI passes

### Closing Checklist

Before closing an issue or PR:

- [ ] Provide clear explanation for closure
- [ ] Link to related issues/PRs if applicable
- [ ] Thank the contributor for their time
- [ ] Add appropriate labels (`duplicate`, `wontfix`, etc.)
- [ ] Update project board or milestone if needed

---

## Escalation Process

### When to Escalate

Escalate to core maintainers when:

- **Security issues:** Always escalate critical security reports
- **Breaking changes:** Major API or contract changes
- **Architectural decisions:** Significant design or technology choices
- **Community conflicts:** Code of conduct violations or disputes
- **Resource needs:** Infrastructure or budget requirements

### How to Escalate

1. **Tag core maintainers** in the issue/PR with `@mention`
2. **Add `needs-discussion` label**
3. **Summarize the situation** and specific decision needed
4. **Provide options** with pros/cons if applicable
5. **Set a deadline** for decision if time-sensitive

### Escalation Channels

- **GitHub Issues:** For technical decisions (public discussion)
- **GitHub Discussions:** For community input on direction
- **Private channels:** For security issues or sensitive matters (see [SECURITY.md](../SECURITY.md))

---

## Security Triage

Security issues require special handling:

### Critical Security Issues

1. **Do not discuss publicly** - use GitHub Security Advisories
2. **Acknowledge privately** within 24 hours
3. **Assess severity** using CVSS or similar framework
4. **Develop fix** in private fork if needed
5. **Coordinate disclosure** with reporter (typically 90-day window)
6. **Release patch** and security advisory simultaneously
7. **Notify users** via appropriate channels

### Low-Risk Security Improvements

1. **Can be discussed publicly** in regular issues
2. **Follow normal triage process** with `security` label
3. **Prioritize appropriately** (usually P1 or P2)

See [SECURITY.md](../SECURITY.md) for full security policy.

---

## Triage Metrics

Track these metrics to improve triage process:

- **Time to first response:** Target < 48 hours for issues, < 24 hours for PRs
- **Time to triage:** Target < 48 hours to remove `needs-triage` label
- **Time to close:** Track by priority level
- **Stale issue rate:** Target < 10% of open issues stale (> 60 days inactive)

Review metrics monthly and adjust process as needed.

---

## Related Documentation

- [CONTRIBUTING.md](../CONTRIBUTING.md) - Contributor setup and workflow
- [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) - Community guidelines
- [SECURITY.md](../SECURITY.md) - Security policy and reporting
- [OPERATIONS.md](OPERATIONS.md) - Operational procedures
- [Backlog Grooming Guide](backlog-grooming.md) - Issue backlog management

---

## Changelog

This triage guide should be reviewed and updated quarterly or when processes change significantly.

**Last Updated:** [Date]
**Next Review:** [Date + 3 months]
