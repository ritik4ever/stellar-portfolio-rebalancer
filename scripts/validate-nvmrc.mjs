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

const indentOf = (line) => line.length - line.trimStart().length

// Strips a YAML comment (a `#` at line start or after whitespace, outside quotes).
function stripComment(line) {
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).trimEnd()
    }
  }
  return line
}

// Returns the lines of each `actions/setup-node` step so its settings are
// checked individually rather than by file-wide counts.
function setupNodeSteps(lines) {
  const steps = []
  lines.forEach((line, index) => {
    if (!/(?:^|\s|-\s)uses:\s*['"]?actions\/setup-node@/.test(line)) return
    let start = index
    while (start >= 0 && !/^\s*-\s/.test(lines[start])) start--
    if (start < 0) start = index
    const stepIndent = indentOf(lines[start])
    let end = start + 1
    while (end < lines.length && (lines[end].trim() === '' || indentOf(lines[end]) > stepIndent)) end++
    steps.push({ line: index + 1, body: lines.slice(start, end) })
  })
  return steps
}

for (const file of readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f)).sort()) {
  const path = join(WORKFLOWS_DIR, file)
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).map(stripComment)

  lines.forEach((line, index) => {
    if (/^\s*node-version:/.test(line)) {
      errors.push(`${path}:${index + 1} hard-codes node-version; use node-version-file: '.nvmrc' instead`)
    }
  })

  for (const step of setupNodeSteps(lines)) {
    const values = step.body
      .map((line) => /^\s*node-version-file:\s*(.*)$/.exec(line)?.[1].trim().replace(/^(['"])(.*)\1$/, '$2'))
      .filter((value) => value !== undefined)
    if (values.length !== 1 || values[0] !== NVMRC) {
      const found = values.length === 0 ? 'none' : values.map((v) => `'${v}'`).join(', ')
      errors.push(`${path}:${step.line} actions/setup-node must set node-version-file: '${NVMRC}' (found ${found})`)
    }
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
