import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateRenovateConfig } from './validate-renovate-config.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (p) => readFileSync(join(root, p), 'utf8')

test('renovate.json matches project toolchains and structure', () => {
  const result = validateRenovateConfig()
  assert.equal(result.valid, true, `Validation failed: ${result.errors.join(', ')}`)
  assert.equal(result.errors.length, 0)
})

test('detects missing enabledManagers for present components', () => {
  const current = JSON.parse(read('renovate.json'))
  const incomplete = {
    ...current,
    enabledManagers: ['npm'], // omitted cargo, terraform, docker-compose, github-actions, etc.
  }
  const result = validateRenovateConfig(incomplete)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('cargo')))
  assert.ok(result.errors.some((e) => e.includes('terraform')))
})

test('detects invalid datasource names in packageRules', () => {
  const current = JSON.parse(read('renovate.json'))
  const invalid = {
    ...current,
    packageRules: [
      {
        matchDatasources: ['invalid-nonexistent-datasource'],
      },
    ],
  }
  const result = validateRenovateConfig(invalid)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('invalid-nonexistent-datasource')))
})

test('detects missing essential ignore paths', () => {
  const current = JSON.parse(read('renovate.json'))
  const badIgnores = {
    ...current,
    ignorePaths: [],
  }
  const result = validateRenovateConfig(badIgnores)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('**/node_modules/**')))
})
