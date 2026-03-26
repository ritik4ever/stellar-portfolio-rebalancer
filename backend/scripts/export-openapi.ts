/**
 * Export OpenAPI 3.0 spec to JSON for Postman import.
 * Run from backend: npm run openapi:export
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import spec from '../src/openapi/spec.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outPath = join(__dirname, '..', 'openapi.json')

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(spec, null, 2))
console.log('OpenAPI spec (generated from spec.ts) exported to:', outPath)
console.log('Import this file in Postman: Import → Upload → openapi.json')
