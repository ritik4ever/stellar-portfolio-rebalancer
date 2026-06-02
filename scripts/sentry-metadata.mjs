#!/usr/bin/env node

import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)

const getArgValue = (flag) => {
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  const value = args[index + 1]
  return value && !value.startsWith('--') ? value.trim() : undefined
}

const hasFlag = (flag) => args.includes(flag)

const fail = (message) => {
  console.error(`\n[sentry-metadata] ${message}`)
  process.exit(1)
}

const readGitSha = () => {
  if (process.env.GITHUB_SHA?.trim()) return process.env.GITHUB_SHA.trim()

  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch (error) {
    fail(`Unable to determine the current git SHA: ${String(error)}`)
  }
}

const deploymentEnvironment = getArgValue('--deployment')
    ?? process.env.DEPLOYMENT_ENVIRONMENT?.trim()
    ?? process.env.SENTRY_ENVIRONMENT?.trim()
    ?? process.env.VITE_SENTRY_ENVIRONMENT?.trim()

if (!deploymentEnvironment) {
  fail('Missing deployment environment. Pass --deployment <name> or set DEPLOYMENT_ENVIRONMENT.')
}

const releaseFromEnv = process.env.SENTRY_RELEASE?.trim() || process.env.VITE_SENTRY_RELEASE?.trim()
const gitSha = readGitSha()
const release = releaseFromEnv || gitSha

if (!/^[0-9a-f]{40}$/i.test(release)) {
  fail(`Sentry release must be the full 40-character git SHA. Received: ${release}`)
}

if (release !== gitSha) {
  fail(`Sentry release (${release}) does not match the current git SHA (${gitSha}).`)
}

const backendEnvironment = process.env.SENTRY_ENVIRONMENT?.trim()
const frontendEnvironment = process.env.VITE_SENTRY_ENVIRONMENT?.trim()
const backendRelease = process.env.SENTRY_RELEASE?.trim()
const frontendRelease = process.env.VITE_SENTRY_RELEASE?.trim()
const deploymentEnv = process.env.DEPLOYMENT_ENVIRONMENT?.trim()
const logDeploymentEnv = process.env.LOG_DEPLOYMENT_ENV?.trim()

const validationErrors = []

if (hasFlag('--validate')) {
  if (!backendEnvironment) {
    validationErrors.push('SENTRY_ENVIRONMENT is missing.')
  } else if (backendEnvironment !== deploymentEnvironment) {
    validationErrors.push(`SENTRY_ENVIRONMENT (${backendEnvironment}) must match the deployment environment (${deploymentEnvironment}).`)
  }

  if (!frontendEnvironment) {
    validationErrors.push('VITE_SENTRY_ENVIRONMENT is missing.')
  } else if (frontendEnvironment !== deploymentEnvironment) {
    validationErrors.push(`VITE_SENTRY_ENVIRONMENT (${frontendEnvironment}) must match the deployment environment (${deploymentEnvironment}).`)
  }

  if (!backendRelease) {
    validationErrors.push('SENTRY_RELEASE is missing.')
  } else if (backendRelease !== release) {
    validationErrors.push(`SENTRY_RELEASE (${backendRelease}) must match the git SHA (${release}).`)
  }

  if (!frontendRelease) {
    validationErrors.push('VITE_SENTRY_RELEASE is missing.')
  } else if (frontendRelease !== release) {
    validationErrors.push(`VITE_SENTRY_RELEASE (${frontendRelease}) must match the git SHA (${release}).`)
  }

  if (backendEnvironment && frontendEnvironment && backendEnvironment !== frontendEnvironment) {
    validationErrors.push(`SENTRY_ENVIRONMENT (${backendEnvironment}) and VITE_SENTRY_ENVIRONMENT (${frontendEnvironment}) must match.`)
  }

  if (backendRelease && frontendRelease && backendRelease !== frontendRelease) {
    validationErrors.push(`SENTRY_RELEASE (${backendRelease}) and VITE_SENTRY_RELEASE (${frontendRelease}) must match.`)
  }

  if (deploymentEnv && deploymentEnv !== deploymentEnvironment) {
    validationErrors.push(`DEPLOYMENT_ENVIRONMENT (${deploymentEnv}) must match the resolved deployment environment (${deploymentEnvironment}).`)
  }

  if (!logDeploymentEnv) {
    validationErrors.push('LOG_DEPLOYMENT_ENV is missing.')
  } else if (logDeploymentEnv !== deploymentEnvironment) {
    validationErrors.push(`LOG_DEPLOYMENT_ENV (${logDeploymentEnv}) must match the resolved deployment environment (${deploymentEnvironment}).`)
  }

  if (validationErrors.length > 0) {
    fail(validationErrors.join('\n'))
  }

  console.log(`[sentry-metadata] OK: release=${release} environment=${deploymentEnvironment}`)
  process.exit(0)
}

console.log(`SENTRY_RELEASE=${release}`)
console.log(`VITE_SENTRY_RELEASE=${release}`)
console.log(`SENTRY_ENVIRONMENT=${deploymentEnvironment}`)
console.log(`VITE_SENTRY_ENVIRONMENT=${deploymentEnvironment}`)
console.log(`DEPLOYMENT_ENVIRONMENT=${deploymentEnvironment}`)
console.log(`LOG_DEPLOYMENT_ENV=${deploymentEnvironment}`)
