import assert from 'node:assert/strict'
import test from 'node:test'
import {
  redactSecrets,
  validateReleaseInputs,
  determineVerificationOutcome,
} from './validate-release-verification.mjs'

test('redactSecrets hides sensitive credentials from log and error output', () => {
  const secretText = 'Deploying with token=ghp_ABC1234567890 and password=mysecretpassword123'
  const redacted = redactSecrets(secretText)
  assert.ok(!redacted.includes('mysecretpassword123'), 'password should be redacted')
  assert.ok(!redacted.includes('ghp_ABC1234567890'), 'token should be redacted')
  assert.ok(redacted.includes('[REDACTED]'), 'redaction marker should be present')
})

test('validateReleaseInputs accepts valid semver release tags and 64-char sha256 digests', () => {
  const validEnv = {
    RELEASE_TAG: 'v1.4.0',
    RELEASE_DIGEST: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    RELEASE_PROVENANCE: 'slsa',
  }
  const result = validateReleaseInputs(validEnv)
  assert.equal(result.valid, true)
  assert.equal(result.errors.length, 0)
})

test('validateReleaseInputs rejects malformed tags and non-sha256 digests before rollout', () => {
  const invalidEnv = {
    RELEASE_TAG: 'invalid-tag-format!!!',
    RELEASE_DIGEST: 'short-not-sha256',
    RELEASE_PROVENANCE: 'unknown-format-12345',
  }
  const result = validateReleaseInputs(invalidEnv)
  assert.equal(result.valid, false)
  assert.ok(result.errors.length >= 2, 'should catch tag and digest format errors')
  assert.ok(result.errors.some((e) => e.includes('RELEASE_TAG')))
  assert.ok(result.errors.some((e) => e.includes('RELEASE_DIGEST')))
})

test('determineVerificationOutcome flags digest mismatch as BLOCKED (SPR-2026-294)', () => {
  const mismatchEnv = {
    RELEASE_TAG: 'v2.0.0',
    EXPECTED_ARTIFACT_DIGEST: '0000000000000000000000000000000000000000000000000000000000000001',
    ACTUAL_ARTIFACT_DIGEST: '9999999999999999999999999999999999999999999999999999999999999999',
  }
  const outcome = determineVerificationOutcome(mismatchEnv)
  assert.equal(outcome.status, 'BLOCKED')
  assert.equal(outcome.reason, 'DIGEST_MISMATCH')
  assert.ok(outcome.message.includes('Artifact digest mismatch'))
})

test('determineVerificationOutcome flags transient pending attestations (SPR-2026-294)', () => {
  const pendingEnv = {
    RELEASE_TAG: 'v2.0.0',
    RELEASE_VERIFICATION_PENDING: 'true',
  }
  const outcome = determineVerificationOutcome(pendingEnv)
  assert.equal(outcome.status, 'TRANSIENT_DELAY')
  assert.equal(outcome.reason, 'ATTESTATION_PENDING')
})

test('determineVerificationOutcome succeeds cleanly on matching verification inputs (SPR-2026-291)', () => {
  const digest = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  const cleanEnv = {
    RELEASE_TAG: 'v1.0.0',
    EXPECTED_ARTIFACT_DIGEST: digest,
    ACTUAL_ARTIFACT_DIGEST: digest,
    RELEASE_PROVENANCE: 'attestation',
  }
  const outcome = determineVerificationOutcome(cleanEnv)
  assert.equal(outcome.status, 'VERIFIED')
  assert.equal(outcome.reason, 'CLEAN_VERIFICATION_PASS')
})
