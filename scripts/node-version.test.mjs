import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')
const version = read('.nvmrc').trim()
const supportedRange = `^${version} || ^24.15.0 || >=26.0.0`

const compare = (left, right) => {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

const satisfiesEngine = (range, actualVersion) => {
  const actual = actualVersion.split('.').map(Number)
  if (range === '*') return true

  return range.split('||').some((alternative) => {
    const tokens = alternative.trim().replace(/(>=|<=|>|<|\^)\s+/g, '$1').split(/\s+/)
    return tokens.every((token) => {
      const match = token.match(/^(\^|>=|<=|>|<)?v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/)
      assert.ok(match, `Unsupported Node engine range token: ${token}`)
      const [, operator = '', major, minor, patch] = match
      const minimum = [major, minor, patch].map((part) => Number(part) || 0)
      const difference = compare(actual, minimum)
      if (operator === '>=') return difference >= 0
      if (operator === '>') return difference > 0
      if (operator === '<=') return difference <= 0
      if (operator === '<') return difference < 0
      if (operator === '^') return difference >= 0 && actual[0] === minimum[0]
      return [major, minor, patch].every((part, index) =>
        part === undefined || part === '*' || part === 'x' || Number(part) === actual[index]
      )
    })
  })
}

test('package engines and installer use the pinned Node minimum', () => {
  assert.match(version, /^\d+\.\d+\.\d+$/)

  for (const directory of ['.', 'backend', 'frontend']) {
    const prefix = directory === '.' ? '' : `${directory}/`
    const packageJson = JSON.parse(read(`${prefix}package.json`))
    const lock = JSON.parse(read(`${prefix}package-lock.json`))
    assert.equal(packageJson.engines.node, supportedRange, `${prefix}package.json`)
    assert.equal(lock.packages[''].engines.node, packageJson.engines.node, `${prefix}package-lock.json`)
    assert.ok(satisfiesEngine(packageJson.engines.node, version))
    assert.ok(!satisfiesEngine(packageJson.engines.node, '24.11.1'))
  }

  assert.match(read('install.sh'), new RegExp(`^REQUIRED_NODE_VERSION="${version.replaceAll('.', '\\.')}"$`, 'm'))
})

test('application Docker builds use the pinned Node version', () => {
  for (const directory of ['backend', 'frontend']) {
    assert.match(read(`${directory}/Dockerfile`), new RegExp(`^FROM node:${version.replaceAll('.', '\\.')}\\-alpine\\b`, 'm'))
  }
})

test('all locked packages accept the declared Node versions', () => {
  for (const directory of ['.', 'backend', 'frontend']) {
    const prefix = directory === '.' ? '' : `${directory}/`
    const lock = JSON.parse(read(`${prefix}package-lock.json`))
    for (const [name, details] of Object.entries(lock.packages)) {
      if (details.engines?.node) {
        for (const supportedVersion of [version, '24.15.0', '26.0.0']) {
          assert.ok(satisfiesEngine(details.engines.node, supportedVersion),
            `${prefix}${name || 'package'} requires Node ${details.engines.node}; rejected ${supportedVersion}`)
        }
      }
    }
  }
})

test('GitHub workflows read the Node version from .nvmrc', () => {
  const workflows = join(root, '.github', 'workflows')
  for (const file of readdirSync(workflows).filter((name) => name.endsWith('.yml'))) {
    const source = read(`.github/workflows/${file}`)
    const setupCount = (source.match(/uses: actions\/setup-node@v4/g) ?? []).length
    const versionFileCount = (source.match(/node-version-file: '\.nvmrc'/g) ?? []).length
    assert.equal(versionFileCount, setupCount, file)
    assert.doesNotMatch(source, /^\s*node-version:/m, file)
  }
})
