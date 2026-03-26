import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = process.cwd()

const BACKEND_EXAMPLE_PATH = join(repoRoot, 'backend/.env.example')
const FRONTEND_EXAMPLE_PATH = join(repoRoot, 'frontend/.env.example')
const BACKEND_SRC_PATH = join(repoRoot, 'backend/src')
const FRONTEND_SRC_PATH = join(repoRoot, 'frontend/src')

const REQUIRED_BACKEND_KEYS = [
  'NODE_ENV',
  'PORT',
  'STELLAR_NETWORK',
  'STELLAR_HORIZON_URL',
  'STELLAR_CONTRACT_ADDRESS',
]

const REQUIRED_FRONTEND_KEYS = ['VITE_API_URL']

const ALLOWED_MISSING_BACKEND_KEYS = new Set([
  'DEBUG',
])

function parseEnvExampleKeys(content) {
  const keys = new Set()
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    if (key) keys.add(key)
  }
  return keys
}

function walkFiles(dir, output = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stats = statSync(fullPath)
    if (stats.isDirectory()) {
      walkFiles(fullPath, output)
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx') || fullPath.endsWith('.js')) {
      output.push(fullPath)
    }
  }
  return output
}

function collectBackendEnvKeys() {
  const files = walkFiles(BACKEND_SRC_PATH).filter(file => !file.includes('/test/'))
  const keys = new Set()
  const processEnvRegex = /process\.env\.([A-Z0-9_]+)/g

  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    for (const match of content.matchAll(processEnvRegex)) keys.add(match[1])
  }
  return keys
}

function collectFrontendEnvKeys() {
  const files = walkFiles(FRONTEND_SRC_PATH)
  const keys = new Set()
  const viteRegex = /(?:import\.meta\.env\.|VITE_)(VITE_[A-Z0-9_]+)/g
  const optionalAccessRegex = /\?\.\s*(VITE_[A-Z0-9_]+)/g
  const importMetaEnvDeclRegex = /readonly\s+(VITE_[A-Z0-9_]+)/g

  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    for (const match of content.matchAll(viteRegex)) keys.add(match[1])
    for (const match of content.matchAll(optionalAccessRegex)) keys.add(match[1])
    if (file.endsWith('vite-env.d.ts')) {
      for (const match of content.matchAll(importMetaEnvDeclRegex)) keys.add(match[1])
    }
  }
  return keys
}

function fail(message) {
  console.error(`\n[env-example-validation] ${message}`)
  process.exit(1)
}

const backendExample = readFileSync(BACKEND_EXAMPLE_PATH, 'utf8')
const frontendExample = readFileSync(FRONTEND_EXAMPLE_PATH, 'utf8')
const backendExampleKeys = parseEnvExampleKeys(backendExample)
const frontendExampleKeys = parseEnvExampleKeys(frontendExample)
const backendCodeKeys = collectBackendEnvKeys()
const frontendCodeKeys = collectFrontendEnvKeys()

const missingRequiredBackend = REQUIRED_BACKEND_KEYS.filter(key => !backendExampleKeys.has(key))
if (missingRequiredBackend.length > 0) {
  fail(`backend/.env.example missing required startup keys: ${missingRequiredBackend.join(', ')}`)
}

const missingRequiredFrontend = REQUIRED_FRONTEND_KEYS.filter(key => !frontendExampleKeys.has(key))
if (missingRequiredFrontend.length > 0) {
  fail(`frontend/.env.example missing required keys: ${missingRequiredFrontend.join(', ')}`)
}

const missingBackendRuntimeKeys = [...backendCodeKeys]
  .filter(key => !backendExampleKeys.has(key))
  .filter(key => !ALLOWED_MISSING_BACKEND_KEYS.has(key))
  .sort()
if (missingBackendRuntimeKeys.length > 0) {
  fail(`backend/.env.example missing env keys referenced by runtime code: ${missingBackendRuntimeKeys.join(', ')}`)
}

const missingFrontendRuntimeKeys = [...frontendCodeKeys]
  .filter(key => !frontendExampleKeys.has(key))
  .sort()
if (missingFrontendRuntimeKeys.length > 0) {
  fail(`frontend/.env.example missing env keys referenced by runtime code: ${missingFrontendRuntimeKeys.join(', ')}`)
}

if (!backendExample.includes('REQUIRED SETTINGS') || !backendExample.includes('OPTIONAL SETTINGS')) {
  fail('backend/.env.example must include explicit REQUIRED SETTINGS and OPTIONAL SETTINGS sections.')
}

if (!frontendExample.includes('REQUIRED SETTINGS') || !frontendExample.includes('OPTIONAL SETTINGS')) {
  fail('frontend/.env.example must include explicit REQUIRED SETTINGS and OPTIONAL SETTINGS sections.')
}

console.log('[env-example-validation] OK: example env files match startup/runtime config surface.')
