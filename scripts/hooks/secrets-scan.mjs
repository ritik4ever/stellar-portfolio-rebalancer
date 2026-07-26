#!/usr/bin/env node
// Runs gitleaks against staged changes (pre-commit) or a full ref range (CI)
// so secrets are caught before they ever reach a shared branch.
//
// Usage:
//   node scripts/hooks/secrets-scan.mjs            # staged changes (pre-commit)
//   node scripts/hooks/secrets-scan.mjs --ci        # full scan, used by CI
//
// See docs/CONTRIBUTING.md "Secrets scanning" section for install and
// allowlist maintenance instructions.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = process.cwd()
const configPath = join(repoRoot, '.gitleaks.toml')
const ci = process.argv.includes('--ci')

function hasCommand(cmd) {
  const result = spawnSync(cmd, ['version'], { stdio: 'ignore' })
  return result.status === 0
}

function run(cmd, args) {
  console.log(`[secrets-scan] ${cmd} ${args.join(' ')}`)
  return spawnSync(cmd, args, { stdio: 'inherit' })
}

if (!existsSync(configPath)) {
  console.error('[secrets-scan] Missing .gitleaks.toml at repo root. Aborting.')
  process.exit(1)
}

const gitleaksArgs = ci
  ? ['detect', '--source', '.', '--redact', '--config', configPath, '-v', '--exit-code', '1']
  : ['protect', '--staged', '--redact', '--config', configPath, '-v', '--exit-code', '1']

let result

if (hasCommand('gitleaks')) {
  result = run('gitleaks', gitleaksArgs)
} else if (hasCommand('docker')) {
  console.log('[secrets-scan] gitleaks binary not found locally, falling back to Docker image.')
  const dockerArgs = [
    'run',
    '--rm',
    '-v',
    `${repoRoot}:/repo`,
    '-w',
    '/repo',
    'zricethezav/gitleaks:latest',
    ...gitleaksArgs,
  ]
  result = run('docker', dockerArgs)
} else {
  const message = [
    '[secrets-scan] Neither the gitleaks binary nor Docker is available.',
    '[secrets-scan] Install gitleaks to get local secrets-scanning coverage — see docs/CONTRIBUTING.md "Secrets scanning".',
  ].join('\n')

  if (ci) {
    // CI must never silently skip: fail closed.
    console.error(message)
    process.exit(1)
  }

  // Local dev: warn loudly but do not block the commit. CI runs the same
  // scan independently and will still catch anything that slips through
  // (see acceptance criteria in the tracking issue).
  console.warn(message)
  console.warn('[secrets-scan] Skipping local scan. CI will still run this check on your PR.')
  process.exit(0)
}

if (result.status !== 0) {
  console.error('')
  console.error('[secrets-scan] Potential secret(s) detected in your changes (see above).')
  console.error('[secrets-scan] Next steps:')
  console.error('  1. Remove the secret and use an environment variable / secret manager instead.')
  console.error('  2. If this is a false positive (test fixture, example key), add an allowlist')
  console.error('     entry in .gitleaks.toml with a comment explaining why, then re-run.')
  console.error('  3. In the rare case you must bypass this locally, use `git commit --no-verify`')
  console.error('     and note the justification in the commit body — CI runs this same scan')
  console.error('     independently and will still block the PR if the finding is real.')
  process.exit(result.status ?? 1)
}

console.log('[secrets-scan] OK — no secrets detected.')
