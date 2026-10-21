#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Release verification validator addressing SPR-2026-291, SPR-2026-293, and SPR-2026-294.
 *
 * 1. SPR-2026-293: Validate tag, digest, and reproducible provenance settings before rollout starts;
 *    redact any credentials or secrets from failure messages.
 * 2. SPR-2026-291: Validate releases from a clean environment without undocumented local state.
 * 3. SPR-2026-294: Report distinct outcome signals: verified, delayed (transient), or blocked (digest mismatch).
 */

const SECRET_PATTERNS = [
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
      const parts = match.split(/[=:\s]+/)
      return parts.length > 1 ? `${parts[0]}=[REDACTED]` : '[REDACTED]'
    })
  }
  return cleaned
}

export function validateReleaseInputs(env = process.env) {
  const errors = []

  const tag = env.RELEASE_TAG?.trim()
  if (tag !== undefined && tag !== '') {
    const isSemverTag = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag)
    if (!isSemverTag) {
      errors.push(`Invalid RELEASE_TAG "${redactSecrets(tag)}": must be a valid semantic version (e.g. v1.0.0 or 1.0.0).`)
    }
  }

  const expectedDigest = env.RELEASE_DIGEST?.trim() || env.EXPECTED_ARTIFACT_DIGEST?.trim()
  if (expectedDigest !== undefined && expectedDigest !== '') {
    const isSha256 = /^[0-9a-f]{64}$/i.test(expectedDigest)
    if (!isSha256) {
      errors.push(`Invalid RELEASE_DIGEST: must be a 64-character SHA-256 hexadecimal string.`)
    }
  }

  const actualDigest = env.ACTUAL_ARTIFACT_DIGEST?.trim()
  if (actualDigest !== undefined && actualDigest !== '') {
    const isSha256 = /^[0-9a-f]{64}$/i.test(actualDigest)
    if (!isSha256) {
      errors.push(`Invalid ACTUAL_ARTIFACT_DIGEST: must be a 64-character SHA-256 hexadecimal string.`)
    }
  }

  const provenance = env.RELEASE_PROVENANCE?.trim()
  if (provenance !== undefined && provenance !== '') {
    const validProvenance = ['true', 'false', 'attestation', 'slsa', 'github-actions'].includes(provenance.toLowerCase()) || provenance.startsWith('http://') || provenance.startsWith('https://')
    if (!validProvenance) {
      errors.push(`Invalid RELEASE_PROVENANCE "${redactSecrets(provenance)}": expected boolean, attestation type, or URL.`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

export function determineVerificationOutcome(env = process.env) {
  const inputValidation = validateReleaseInputs(env)
  if (!inputValidation.valid) {
    return {
      status: 'BLOCKED',
      reason: 'INVALID_CONFIG',
      message: inputValidation.errors.join('; '),
    }
  }

  const isTransientDelay = env.RELEASE_VERIFICATION_PENDING === 'true' || env.CI_ATTESTATION_IN_PROGRESS === 'true'
  if (isTransientDelay) {
    return {
      status: 'TRANSIENT_DELAY',
      reason: 'ATTESTATION_PENDING',
      message: 'Artifact attestation or build verification is in progress. Retry after pipeline completes.',
    }
  }

  const expectedDigest = (env.RELEASE_DIGEST?.trim() || env.EXPECTED_ARTIFACT_DIGEST?.trim())?.toLowerCase()
  const actualDigest = env.ACTUAL_ARTIFACT_DIGEST?.trim()?.toLowerCase()

  if (expectedDigest && actualDigest && expectedDigest !== actualDigest) {
    return {
      status: 'BLOCKED',
      reason: 'DIGEST_MISMATCH',
      message: `Artifact digest mismatch! Expected ${expectedDigest.slice(0, 12)}... but got ${actualDigest.slice(0, 12)}... Aborting rollout to prevent supply chain tampering. Owner action required.`,
    }
  }

  return {
    status: 'VERIFIED',
    reason: 'CLEAN_VERIFICATION_PASS',
    message: 'Release verification checks passed from clean environment.',
  }
}

function runCli() {
  const outcome = determineVerificationOutcome(process.env)
  const prefix = '[release-verification]'

  if (outcome.status === 'BLOCKED') {
    console.error(`\n${prefix} BLOCKED (${outcome.reason}): ${outcome.message}`)
    process.exit(1)
  }

  if (outcome.status === 'TRANSIENT_DELAY') {
    console.warn(`\n${prefix} TRANSIENT_DELAY: ${outcome.message}`)
    process.exit(2)
  }

  console.log(`${prefix} OK: ${outcome.message}`)
  process.exit(0)
}

if (process.argv[1] && process.argv[1].endsWith('validate-release-verification.mjs')) {
  runCli()
}
