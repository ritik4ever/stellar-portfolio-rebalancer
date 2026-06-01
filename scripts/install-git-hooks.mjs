import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const hooksPath = 'scripts/hooks'
const requiredHooks = ['pre-commit', 'pre-push']

for (const hook of requiredHooks) {
  const hookPath = join(hooksPath, hook)
  if (!existsSync(hookPath)) {
    console.error(`[hooks] Missing ${hookPath}`)
    process.exit(1)
  }
}

const result = spawnSync('git', ['config', 'core.hooksPath', hooksPath], {
  stdio: 'inherit',
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

console.log(`[hooks] Installed optional Git hooks from ${hooksPath}`)
