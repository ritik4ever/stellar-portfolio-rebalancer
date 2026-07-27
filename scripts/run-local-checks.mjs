import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const mode = process.argv[2]

const CHECKS = {
  'pre-commit': [
    { cwd: '.', script: 'validate:env-examples', label: 'Environment examples and docs validation' },
    { cwd: 'backend', script: 'lint', label: 'Backend lint', optional: true },
    { cwd: 'frontend', script: 'lint', label: 'Frontend lint', optional: true },
    { cwd: '.', script: 'format', label: 'Workspace format check', optional: true },
  ],
  'pre-push': [
    { cwd: '.', script: 'validate:env-examples', label: 'Environment examples and docs validation' },
    { cwd: 'backend', script: 'lint', label: 'Backend lint', optional: true },
    { cwd: 'frontend', script: 'lint', label: 'Frontend lint', optional: true },
    { cwd: 'frontend', script: 'test', label: 'Frontend quick tests' },
    { cwd: 'backend', script: 'test', label: 'Backend quick tests' },
    { cwd: '.', script: 'format', label: 'Workspace format check', optional: true },
  ],
}

if (!CHECKS[mode]) {
  console.error(`[local-checks] Unknown mode "${mode}". Use pre-commit or pre-push.`)
  process.exit(1)
}

function readScripts(cwd) {
  const packagePath = join(cwd, 'package.json')
  return JSON.parse(readFileSync(packagePath, 'utf8')).scripts ?? {}
}

for (const check of CHECKS[mode]) {
  const scripts = readScripts(check.cwd)

  if (!scripts[check.script]) {
    if (!check.optional) {
      console.error(`[local-checks] FAIL ${check.label}: ${check.cwd}/package.json missing "${check.script}" script.`)
      process.exit(1)
    }
    console.log(`[local-checks] SKIP ${check.label}: ${check.cwd}/package.json has no "${check.script}" script.`)
    continue
  }

  console.log(`[local-checks] RUN ${check.label}: npm run ${check.script} (${check.cwd})`)
  const result = spawnSync('npm', ['run', check.script], {
    cwd: check.cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.status !== 0) {
    console.error(`[local-checks] FAIL ${check.label}`)
    process.exit(result.status ?? 1)
  }
}

console.log(`[local-checks] OK ${mode}`)
