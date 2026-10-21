#!/usr/bin/env node

/**
 * Environment Reference Validator & Recovery Orchestrator
 *
 * Addressing:
 * - SPR-2026-296: Validate Environment reference from a clean environment without undocumented local state.
 * - SPR-2026-297: Recover from failure during Environment reference; clear rollback boundary for production-only variables.
 * - SPR-2026-298: Check Environment reference inputs before work; redact secrets from failure messages.
 * - SPR-2026-299: Report Environment reference outcomes (distinguishable: VERIFIED, TRANSIENT_DELAY, BLOCKED) with owner action.
 * - SPR-2026-300: Make Environment reference verification repeatable across environments with clean smoke check.
 */

const SECRET_PATTERNS = [
  /S[A-Z0-9]{55}/g,
  /password[=:\s]+[^\s,]+/gi,
  /secret[=:\s]+[^\s,]+/gi,
  /token[=:\s]+[^\s,]+/gi,
  /key[=:\s]+[^\s,]+/gi,
  /ghp_[a-zA-Z0-9]+/g,
  /sk-[a-zA-Z0-9]+/g,
]

export function redactSecrets(input) {
  if (typeof input !== 'string') return String(input)
  let cleaned = input
  for (const pattern of SECRET_PATTERNS) {
    cleaned = cleaned.replace(pattern, (match) => {
      if (match.includes('[REDACTED')) return match
      if (match.startsWith('S') && match.length === 56) {
        return '[REDACTED_STELLAR_SECRET]'
      }
      const parts = match.split(/[=:\s]+/)
      return parts.length > 1 ? `${parts[0]}=[REDACTED]` : '[REDACTED]'
    })
  }
  return cleaned
}

export const MINIMUM_VIABLE_LOCAL_DEFAULTS = {
  NODE_ENV: 'development',
  PORT: '3001',
  STELLAR_NETWORK: 'testnet',
  STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
  ENABLE_AUTO_REBALANCER: 'false',
  VITE_API_URL: 'http://localhost:3001',
}

export const PRODUCTION_MANDATORY_VARS = [
  {
    name: 'DATABASE_URL',
    check: (env) => Boolean(env.DATABASE_URL?.trim() || (env.PGHOST?.trim() && env.PGDATABASE?.trim() && env.PGUSER?.trim())),
    description: 'PostgreSQL connection URI (SQLite is prohibited in production).',
    ownerAction: 'Configure production Postgres cluster URI in secrets manager.',
  },
  {
    name: 'REDIS_URL',
    check: (env) => Boolean(env.REDIS_URL?.trim()),
    description: 'Redis connection URI for BullMQ workers and distributed rate limiting.',
    ownerAction: 'Provision ElastiCache / Redis cluster and inject REDIS_URL before deploying.',
  },
  {
    name: 'JWT_SECRET',
    check: (env) => Boolean(env.JWT_SECRET && env.JWT_SECRET.trim().length >= 32),
    description: 'Cryptographically secure 256-bit JWT secret (minimum 32 characters).',
    ownerAction: 'Generate and inject 32+ character JWT secret token in secrets manager.',
  },
  {
    name: 'CORS_ORIGINS',
    check: (env) => Boolean(env.CORS_ORIGINS?.trim() && !env.CORS_ORIGINS.includes('*')),
    description: 'Explicit list of allowed production CORS origins (* is prohibited in production).',
    ownerAction: 'Specify exact production frontend origins in CORS_ORIGINS.',
  },
]

export function validateEnvironmentInputs(env = process.env) {
  const errors = []
  const effectiveEnv = { ...MINIMUM_VIABLE_LOCAL_DEFAULTS, ...env }
  const isProduction = effectiveEnv.NODE_ENV === 'production'

  // Validate Port
  const portNum = Number(effectiveEnv.PORT)
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    errors.push(`Invalid PORT "${redactSecrets(effectiveEnv.PORT)}": must be an integer between 1 and 65535.`)
  }

  // Validate Stellar Network
  const validNetworks = ['testnet', 'mainnet', 'futurenet', 'standalone', 'local']
  if (!validNetworks.includes(effectiveEnv.STELLAR_NETWORK?.toLowerCase())) {
    errors.push(`Invalid STELLAR_NETWORK "${redactSecrets(effectiveEnv.STELLAR_NETWORK)}": must be one of [${validNetworks.join(', ')}].`)
  }

  // Production-only Variable Audit & Rollback Boundaries (SPR-2026-297)
  const missingProductionVars = []
  if (isProduction) {
    for (const rule of PRODUCTION_MANDATORY_VARS) {
      if (!rule.check(effectiveEnv)) {
        missingProductionVars.push({
          variable: rule.name,
          description: rule.description,
          ownerAction: rule.ownerAction,
        })
        errors.push(`Missing production variable "${rule.name}": ${rule.description}`)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    missingProductionVars,
    isProduction,
    effectiveEnv,
    rollbackBoundary: missingProductionVars.length > 0 ? 'HALT_BEFORE_TRAFFIC_SHIFT' : null,
  }
}

export function determineEnvironmentReferenceOutcome(env = process.env) {
  const validation = validateEnvironmentInputs(env)

  if (!validation.valid) {
    if (validation.missingProductionVars.length > 0) {
      const actions = validation.missingProductionVars.map((v) => `${v.variable} -> ${v.ownerAction}`).join(' | ')
      return {
        status: 'BLOCKED',
        reason: 'MISSING_PRODUCTION_VARIABLE',
        rollbackBoundary: validation.rollbackBoundary,
        message: `Deployment halted at boundary "${validation.rollbackBoundary}". Missing required production variables: ${validation.missingProductionVars.map((v) => v.variable).join(', ')}.`,
        ownerAction: actions,
      }
    }

    return {
      status: 'BLOCKED',
      reason: 'INVALID_CONFIG',
      rollbackBoundary: 'ABORT_STARTUP',
      message: validation.errors.map((e) => redactSecrets(e)).join('; '),
      ownerAction: 'Correct malformed environment variables before restarting service.',
    }
  }

  // Check for transient delay state (e.g. initial infrastructure bootstrap or DNS warm up)
  if (env.INFRASTRUCTURE_BOOTSTRAP_PENDING === 'true' || env.REDIS_DISCOVERY_PENDING === 'true') {
    return {
      status: 'TRANSIENT_DELAY',
      reason: 'INFRASTRUCTURE_WARMUP',
      rollbackBoundary: 'RETRY_WITH_EXPONENTIAL_BACKOFF',
      message: 'Infrastructure bootstrap or service discovery is currently warming up.',
      ownerAction: 'Allow initial handshake window (10-30s) before evaluating healthy state.',
    }
  }

  return {
    status: 'VERIFIED',
    reason: 'CLEAN_ENV_READY',
    rollbackBoundary: null,
    message: validation.isProduction
      ? 'Production environment reference verification passed all checks.'
      : 'Clean local environment verified against documented defaults.',
    ownerAction: 'Proceed with normal service startup.',
  }
}

export function runEnvironmentSmokeCheck(env = {}) {
  // SPR-2026-300: Repeatable smoke check runnable from empty clean environment or mock environments
  const outcome = determineEnvironmentReferenceOutcome(env)
  return {
    repeatable: true,
    outcome,
    timestamp: new Date().toISOString(),
  }
}

function runCli() {
  const outcome = determineEnvironmentReferenceOutcome(process.env)
  const prefix = '[environment-reference]'

  if (outcome.status === 'BLOCKED') {
    console.error(`\n${prefix} BLOCKED (${outcome.reason}): ${outcome.message}`)
    if (outcome.ownerAction) {
      console.error(`${prefix} REQUIRED OWNER ACTION: ${outcome.ownerAction}`)
    }
    if (outcome.rollbackBoundary) {
      console.error(`${prefix} ROLLBACK BOUNDARY: ${outcome.rollbackBoundary}`)
    }
    process.exit(1)
  }

  if (outcome.status === 'TRANSIENT_DELAY') {
    console.warn(`\n${prefix} TRANSIENT_DELAY (${outcome.reason}): ${outcome.message}`)
    console.warn(`${prefix} RETRY ACTION: ${outcome.ownerAction}`)
    process.exit(2)
  }

  console.log(`${prefix} OK: ${outcome.message}`)
  process.exit(0)
}

if (process.argv[1] && process.argv[1].endsWith('validate-environment-reference.mjs')) {
  runCli()
}
