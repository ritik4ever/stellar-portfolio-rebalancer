/**
 * Export OpenAPI 3.0 spec to JSON for Postman import.
 * Run from backend: npm run openapi:export
 */
import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcPath = join(__dirname, '..', 'src', 'openapi', 'openapi.json')
const outPath = join(__dirname, '..', 'openapi.json')

mkdirSync(dirname(outPath), { recursive: true })
copyFileSync(srcPath, outPath)
console.log('OpenAPI spec copied to:', outPath)
console.log('Import this file in Postman: Import → Upload → openapi.json')
