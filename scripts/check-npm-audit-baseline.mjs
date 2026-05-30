#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const baselinePath = resolve(repoRoot, 'security/npm-audit-baseline.json')

const args = process.argv.slice(2)
const scopes = []
let writeBaseline = false

for (const arg of args) {
  if (arg === '--write-baseline' || arg === '--update') {
    writeBaseline = true
    continue
  }
  scopes.push(arg)
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
const requestedScopes = scopes.length > 0 ? scopes : Object.keys(baseline.scopes)
const severities = ['info', 'low', 'moderate', 'high', 'critical', 'total']

function runAudit(scopeName) {
  const scope = baseline.scopes[scopeName]
  if (!scope) {
    throw new Error(`Unknown audit scope "${scopeName}"`)
  }

  const result = spawnSync('npm', ['audit', '--json', '--omit=dev'], {
    cwd: resolve(repoRoot, scope.path),
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })

  const output = (result.stdout || result.stderr || '').trim()
  if (!output) {
    throw new Error(`npm audit produced no output for scope "${scopeName}"`)
  }

  let report
  try {
    report = JSON.parse(output)
  } catch (error) {
    throw new Error(`Failed to parse npm audit output for scope "${scopeName}": ${error.message}\n${output}`)
  }

  const counts = {}
  for (const severity of severities) {
    counts[severity] = report.metadata?.vulnerabilities?.[severity] ?? 0
  }

  return counts
}

function formatCounts(counts) {
  return severities.map((severity) => `${severity}=${counts[severity]}`).join(' ')
}

let hasFailure = false
const nextBaseline = structuredClone(baseline)

for (const scopeName of requestedScopes) {
  const current = runAudit(scopeName)
  const expected = baseline.scopes[scopeName].baseline
  const deltas = severities
    .filter((severity) => current[severity] > expected[severity])
    .map((severity) => `${severity}: ${current[severity]} > ${expected[severity]}`)

  if (deltas.length > 0) {
    hasFailure = true
    console.error(`[audit-policy] ${scopeName} exceeded the reviewed baseline`)
    for (const delta of deltas) {
      console.error(`  ${delta}`)
    }
    console.error(`  current:  ${formatCounts(current)}`)
    console.error(`  baseline: ${formatCounts(expected)}`)
    continue
  }

  console.log(`[audit-policy] ${scopeName} OK (${formatCounts(current)})`)
  if (writeBaseline) {
    nextBaseline.scopes[scopeName].baseline = current
  }
}

if (writeBaseline) {
  nextBaseline.generatedAt = new Date().toISOString()
  writeFileSync(baselinePath, `${JSON.stringify(nextBaseline, null, 2)}\n`)
  console.log(`[audit-policy] Baseline refreshed at ${baselinePath}`)
}

if (hasFailure) {
  console.error('[audit-policy] Update the baseline only after the findings are reviewed and accepted.')
  process.exit(1)
}
