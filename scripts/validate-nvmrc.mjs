import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Enforces .nvmrc as the single source of truth for the Node.js version so it
// cannot drift silently from what CI, the Docker images and package engines use:
//
//   1. .nvmrc holds one exact version (e.g. 22.22.2).
//   2. Every `actions/setup-node` step in .github/workflows reads
//      `node-version-file: '.nvmrc'` and never hard-codes `node-version:`.
//   3. The backend/frontend Dockerfiles build on that exact Node version.
//   4. The version satisfies `engines.node` in every package.json.
//
// Zero dependencies: runs in CI (no npm install) and in the pre-commit hook,
// which runs before node_modules may exist.
//
// Usage: node scripts/validate-nvmrc.mjs

const NVMRC = '.nvmrc'
const WORKFLOWS_DIR = '.github/workflows'
const DOCKERFILES = ['backend/Dockerfile', 'frontend/Dockerfile']
const PACKAGE_FILES = ['package.json', 'backend/package.json', 'frontend/package.json']

const errors = []

function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text)
  return match ? match.slice(1, 4).map(Number) : null
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

// Supports the comparator forms used in this repo's engines fields:
// `^x.y.z`, `>=x.y.z`, and exact `x.y.z`, joined with `||`.
function satisfies(version, range) {
  return range.split('||').some((part) => {
    const comparator = part.trim()
    const caret = /^\^(\d+\.\d+\.\d+)$/.exec(comparator)
    if (caret) {
      const min = parseVersion(caret[1])
      return version[0] === min[0] && compare(version, min) >= 0
    }
    const gte = /^>=\s*(\d+\.\d+\.\d+)$/.exec(comparator)
    if (gte) return compare(version, parseVersion(gte[1])) >= 0
    const exact = parseVersion(comparator)
    if (exact) return compare(version, exact) === 0
    errors.push(`unsupported engines.node comparator "${comparator}"; extend scripts/validate-nvmrc.mjs`)
    return false
  })
}

let raw
try {
  raw = readFileSync(NVMRC, 'utf8').trim()
} catch {
  console.error(`[nvmrc] FAIL ${NVMRC} is missing. Restore it so the Node.js version stays enforced.`)
  process.exit(1)
}

const version = parseVersion(raw)
if (!version) {
  console.error(`[nvmrc] FAIL ${NVMRC} must contain one exact version like 22.22.2, got "${raw}"`)
  process.exit(1)
}
const versionText = version.join('.')

for (const file of readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f)).sort()) {
  const path = join(WORKFLOWS_DIR, file)
  const text = readFileSync(path, 'utf8')
  const setupSteps = text.match(/uses:\s*actions\/setup-node@/g)?.length ?? 0
  if (setupSteps === 0) continue

  if (/^\s*node-version:/m.test(text)) {
    errors.push(`${path} hard-codes node-version; use node-version-file: '.nvmrc' instead`)
  }
  const fileRefs = text.match(/node-version-file:\s*['"]?\.nvmrc['"]?/g)?.length ?? 0
  if (fileRefs < setupSteps) {
    errors.push(
      `${path} has ${setupSteps} actions/setup-node step(s) but only ${fileRefs} read node-version-file: '.nvmrc'`,
    )
  }
}

for (const path of DOCKERFILES) {
  const text = readFileSync(path, 'utf8')
  const images = [...text.matchAll(/^FROM\s+node:(\S+)/gim)].map((m) => m[1])
  if (images.length === 0) {
    errors.push(`${path} has no node base image; update DOCKERFILES in scripts/validate-nvmrc.mjs`)
  }
  for (const tag of images) {
    if (!tag.startsWith(`${versionText}-`) && tag !== versionText) {
      errors.push(`${path} uses node:${tag} but ${NVMRC} pins ${versionText}`)
    }
  }
}

for (const path of PACKAGE_FILES) {
  const range = JSON.parse(readFileSync(path, 'utf8')).engines?.node
  if (!range) {
    errors.push(`${path} has no engines.node range`)
  } else if (!satisfies(version, range)) {
    errors.push(`${NVMRC} ${versionText} does not satisfy engines.node "${range}" in ${path}`)
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`[nvmrc] FAIL ${error}`)
  process.exit(1)
}

console.log(`[nvmrc] OK ${NVMRC} ${versionText} is enforced by CI workflows, Dockerfiles and engines.node`)
