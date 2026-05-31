# Flaky Test Management

This document defines the process for identifying, quarantining, fixing, and re-enabling flaky tests.

## What is a Flaky Test?

A test is considered **flaky** when it produces both passing and failing results across multiple runs without any code changes. Common causes include:

- Race conditions and timing dependencies
- Network or API call failures
- Non-deterministic test ordering
- Environment-specific behavior (timezone, locale)
- Flaky third-party service responses

## Lifecycle

```
┌─────────────┐
│  Detected   │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Quarantined │ ← Moved to quarantine directory/skip list
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Owned     │ ← Assigned to a maintainer
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Fixed     │ ← Root cause resolved
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Re-enabled  │ ← Test returns to normal CI
└─────────────┘
```

## Process

### 1. Detection

Flaky tests are identified through:
- CI build logs showing non-deterministic failures
- `git bisect` showing no related code change
- Test retry passes on re-run
- Developer reports in issues

### 2. Quarantine

Once a test is identified as flaky:
1. Create an issue documenting the test and observed failures
2. Add the `flaky` label to the issue
3. Move the test to a quarantine directory or add to the skip list
4. The test is skipped in normal CI but still runs in a weekly quarantine workflow

### 3. Ownership

Each quarantined test must have an owner:
- The owner is responsible for investigating and fixing the test
- Owner is assigned in the GitHub issue
- If unowned for 14 days, the test is escalated to the team lead

### 4. Fixing

To fix a flaky test:
1. Re-enable the test locally and reproduce the failure
2. Identify the root cause (timeout, race condition, etc.)
3. Apply the fix (add awaits, increase timeouts, mock external calls)
4. Run the test 10 times consecutively to confirm stability
5. Keep the test in quarantine until 5 consecutive CI runs pass

### 5. Re-enable

After the fix is verified:
1. Remove the test from the quarantine list
2. Close the tracking issue with a note on the root cause and fix
3. Monitor CI for the next week to ensure no regression

## Quarantine Implementation

### Backend Tests
Tests in `backend/src/test/quarantine/` are excluded from the standard CI test run but executed in a separate weekly workflow.

```yaml
# Weekly quarantine check workflow
name: Quarantine Test Check
on:
  schedule:
    - cron: '0 6 * * 1'  # Every Monday at 6 AM UTC
jobs:
  quarantine:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cd backend && npm test -- --include-quarantine
```

### Frontend Tests
Flaky frontend tests are tagged with `describe.skip` or `it.skip` and tracked in a dedicated GitHub issue.

```typescript
// Example: Quarantined test with skip
describe.skip("FlakyComponent (quarantine - issue #123)", () => {
  it("should render correctly", () => {
    // Test body
  });
});
```

## Monitoring

- All flaky test issues are tracked with the `flaky` label
- A weekly CI workflow runs quarantined tests and reports results
- The team reviews flaky test status in the weekly sync meeting
