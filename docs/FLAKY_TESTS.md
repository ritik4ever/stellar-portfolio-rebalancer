# Flaky Test Quarantine Process

## What is a Flaky Test?
A test that passes and fails intermittently without code changes.

## Quarantine Steps

1. **Detect**: Identify the flaky test from CI logs
2. **Report**: Open an issue with:
   - Test name and file
   - Failure rate estimate
   - CI run links
3. **Quarantine**: Add test to `quarantine.list` to skip in CI
4. **Assign**: Assign the issue to an owner for fixing
5. **Fix**: Owner investigates root cause and fixes
6. **Re-enable**: Remove from quarantine.list once fixed

## Quarantine File Format
```
# Format: test_file:test_name
# Example:
backend/src/test/api.test.ts:test_flaky_endpoint
```

## Owner Process
- Each quarantined test has an assigned owner
- Owner has 7 days to fix or escalate
- Unfixed tests are removed after 30 days
