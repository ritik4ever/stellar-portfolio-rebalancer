import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)

const run = (cmd, cmdArgs) => {
  const result = spawnSync(cmd, cmdArgs, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.error) {
    console.error(`[test] Failed to run command: ${cmd} ${cmdArgs.join(' ')}`)
    console.error(result.error)
    process.exit(1)
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status)
  }
}

const ensureBackendTestDeps = () => {
  const vitestEntrypoint = join(process.cwd(), 'backend', 'node_modules', 'vitest', 'vitest.mjs')
  if (existsSync(vitestEntrypoint)) {
    return
  }

  console.log('[test] Backend test dependencies are missing; installing backend packages...')
  run('npm', ['run', 'install:backend'])
}

if (args.length > 0) {
  console.log('[test] Detected test filters; running backend tests only and skipping contracts.')
  ensureBackendTestDeps()
  run('npm', ['run', 'test:backend', '--', ...args])
  process.exit(0)
}

run('npm', ['run', 'test:contracts'])
ensureBackendTestDeps()
run('npm', ['run', 'test:backend'])
