import assert from 'node:assert/strict'
import test from 'node:test'
import {
  redactSecrets,
  validateEnvironmentInputs,
  determineEnvironmentReferenceOutcome,
  runEnvironmentSmokeCheck,
  MINIMUM_VIABLE_LOCAL_DEFAULTS,
} from './validate-environment-reference.mjs'

test('redactSecrets sanitizes sensitive keys, tokens, and Stellar secret seeds', () => {
  const sensitive = 'Error connecting with token=ghp_secretToken123456 and password=superSecretPassword and secret=SB3VABCDEFGHIJ123456789012345678901234567890123456789012'
  const redacted = redactSecrets(sensitive)
  assert.ok(!redacted.includes('superSecretPassword'), 'password must be redacted')
  assert.ok(!redacted.includes('ghp_secretToken123456'), 'token must be redacted')
  assert.ok(!redacted.includes('SB3VABCDEFGHIJ123456789012345678901234567890123456789012'), 'Stellar secret seed must be redacted')
  assert.ok(redacted.includes('[REDACTED]'), 'generic redaction marker must be present')
  assert.ok(redacted.includes('[REDACTED_STELLAR_SECRET]'), 'Stellar secret redaction marker must be present')
})

test('SPR-2026-296: validateEnvironmentInputs succeeds from a clean environment without undocumented local state', () => {
  // Empty environment object simulates completely clean checkout
  const cleanEnv = {}
  const result = validateEnvironmentInputs(cleanEnv)
  assert.equal(result.valid, true)
  assert.equal(result.errors.length, 0)
  assert.equal(result.effectiveEnv.PORT, MINIMUM_VIABLE_LOCAL_DEFAULTS.PORT)
  assert.equal(result.effectiveEnv.STELLAR_NETWORK, MINIMUM_VIABLE_LOCAL_DEFAULTS.STELLAR_NETWORK)
  assert.equal(result.effectiveEnv.NODE_ENV, 'development')

  const outcome = determineEnvironmentReferenceOutcome(cleanEnv)
  assert.equal(outcome.status, 'VERIFIED')
  assert.equal(outcome.reason, 'CLEAN_ENV_READY')
})

test('SPR-2026-297: missing production-only variables provide clear rollback boundary and owner actions', () => {
  const prodEnvWithoutDb = {
    NODE_ENV: 'production',
    PORT: '3001',
    STELLAR_NETWORK: 'mainnet',
    // Missing DATABASE_URL, REDIS_URL, JWT_SECRET, CORS_ORIGINS
  }
  const result = validateEnvironmentInputs(prodEnvWithoutDb)
  assert.equal(result.valid, false)
  assert.equal(result.rollbackBoundary, 'HALT_BEFORE_TRAFFIC_SHIFT')
  assert.ok(result.missingProductionVars.some((v) => v.variable === 'DATABASE_URL'))
  assert.ok(result.missingProductionVars.some((v) => v.variable === 'REDIS_URL'))

  const outcome = determineEnvironmentReferenceOutcome(prodEnvWithoutDb)
  assert.equal(outcome.status, 'BLOCKED')
  assert.equal(outcome.reason, 'MISSING_PRODUCTION_VARIABLE')
  assert.equal(outcome.rollbackBoundary, 'HALT_BEFORE_TRAFFIC_SHIFT')
  assert.ok(outcome.ownerAction.includes('Configure production Postgres cluster'))
  assert.ok(outcome.ownerAction.includes('Provision ElastiCache / Redis cluster'))
})

test('SPR-2026-298: malformed environment inputs halt before rollout with redacted error messages', () => {
  const malformedEnv = {
    PORT: 'invalid-port-string-99999',
    STELLAR_NETWORK: 'unsupported-stellar-chain',
    SECRET_KEY: 'SB3VABCDEFGHIJ123456789012345678901234567890123456789012',
  }
  const result = validateEnvironmentInputs(malformedEnv)
  assert.equal(result.valid, false)
  assert.ok(result.errors.length >= 2)
  assert.ok(result.errors.some((e) => e.includes('Invalid PORT')))
  assert.ok(result.errors.some((e) => e.includes('Invalid STELLAR_NETWORK')))

  const outcome = determineEnvironmentReferenceOutcome(malformedEnv)
  assert.equal(outcome.status, 'BLOCKED')
  assert.equal(outcome.reason, 'INVALID_CONFIG')
  assert.equal(outcome.rollbackBoundary, 'ABORT_STARTUP')
})

test('SPR-2026-299: distinguishable outcome reporting for verified, transient delay, and blocked states', () => {
  // 1. Transient delay state (infrastructure bootstrap warming up)
  const transientEnv = {
    INFRASTRUCTURE_BOOTSTRAP_PENDING: 'true',
  }
  const delayOutcome = determineEnvironmentReferenceOutcome(transientEnv)
  assert.equal(delayOutcome.status, 'TRANSIENT_DELAY')
  assert.equal(delayOutcome.reason, 'INFRASTRUCTURE_WARMUP')
  assert.ok(delayOutcome.ownerAction.includes('Allow initial handshake window'))

  // 2. Production verified state
  const validProdEnv = {
    NODE_ENV: 'production',
    PORT: '3001',
    STELLAR_NETWORK: 'mainnet',
    DATABASE_URL: 'postgresql://prod_user:secret_pass@db.example.internal:5432/stellar_rebalancer',
    REDIS_URL: 'redis://:auth_token@redis.example.internal:6379',
    JWT_SECRET: 'a_very_secure_and_cryptographically_sound_jwt_secret_token_123',
    CORS_ORIGINS: 'https://rebalance.stellar.org,https://app.stellar.org',
  }
  const verifiedOutcome = determineEnvironmentReferenceOutcome(validProdEnv)
  assert.equal(verifiedOutcome.status, 'VERIFIED')
  assert.equal(verifiedOutcome.reason, 'CLEAN_ENV_READY')
  assert.equal(verifiedOutcome.rollbackBoundary, null)
})

test('SPR-2026-300: repeatable smoke check executes reliably without state retention', () => {
  const firstCheck = runEnvironmentSmokeCheck()
  const secondCheck = runEnvironmentSmokeCheck()

  assert.equal(firstCheck.repeatable, true)
  assert.equal(secondCheck.repeatable, true)
  assert.equal(firstCheck.outcome.status, 'VERIFIED')
  assert.equal(secondCheck.outcome.status, 'VERIFIED')
  assert.equal(firstCheck.outcome.reason, 'CLEAN_ENV_READY')
  assert.equal(secondCheck.outcome.reason, 'CLEAN_ENV_READY')
})
