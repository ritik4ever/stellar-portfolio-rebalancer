import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import spec from '../src/openapi/spec.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..', '..')
const openapiJsonPath = join(__dirname, '..', 'openapi.json')
const apiMdPath = join(rootDir, 'API.md')

let exitCode = 0

// 1. Validate spec.ts vs openapi.json
console.log('Checking openapi.json sync...')
if (!existsSync(openapiJsonPath)) {
    console.error('❌ openapi.json missing. Run "npm run openapi:export" first.')
    exitCode = 1
} else {
    try {
        const exportedJson = JSON.parse(readFileSync(openapiJsonPath, 'utf8'))
        const currentJson = JSON.parse(JSON.stringify(spec))
        
        // Compare paths
        if (JSON.stringify(exportedJson.paths) !== JSON.stringify(currentJson.paths)) {
            console.error('❌ openapi.json is out of sync with spec.ts. Run "npm run openapi:export" to refresh.')
            exitCode = 1
        } else {
            console.log('✅ openapi.json is in sync with spec.ts')
        }
    } catch (error) {
        console.error('❌ Error parsing openapi.json:', error)
        exitCode = 1
    }
}

// 2. Validate spec.ts vs API.md
console.log('\nChecking API.md sync...')
if (!existsSync(apiMdPath)) {
    console.error('❌ API.md missing in root.')
    exitCode = 1
} else {
    try {
        const apiMd = readFileSync(apiMdPath, 'utf8')
        const mdEndpoints = extractMdEndpoints(apiMd)
        const specPaths = Object.keys(spec.paths)
        
        const missingInMd: string[] = []

        for (const path of specPaths) {
            const methods = Object.keys(spec.paths[path])
            for (const method of methods) {
                // Skip if it's not a method (e.g. parameters)
                if (!['get', 'post', 'put', 'delete', 'patch'].includes(method.toLowerCase())) continue

                const upperMethod = method.toUpperCase()
                const found = mdEndpoints.find(e => e.path === path && e.method === upperMethod)
                if (!found) {
                    missingInMd.push(`${upperMethod} ${path}`)
                }
            }
        }

        if (missingInMd.length > 0) {
            console.error('❌ The following endpoints are in spec.ts but missing or mismatched in API.md:')
            missingInMd.forEach(e => console.error(`   - ${e}`))
            exitCode = 1
        }

        // Check for endpoints in MD that are NOT in spec
        const extraInMd = mdEndpoints.filter(e => {
            const specPath = spec.paths[e.path]
            return !specPath || !specPath[e.method.toLowerCase()]
        })

        if (extraInMd.length > 0) {
            console.warn('⚠️ The following endpoints are in API.md but missing in spec.ts (deprecated or typo?):')
            extraInMd.forEach(e => console.warn(`   - ${e.method} ${e.path}`))
        }

        if (missingInMd.length === 0) {
            console.log('✅ API.md is in sync with spec.ts')
        }
    } catch (error) {
        console.error('❌ Error parsing API.md:', error)
        exitCode = 1
    }
}

if (exitCode === 0) {
    console.log('\n✨ API documentation is synchronized.')
} else {
    console.error('\n🚨 Drift detected in API documentation.')
}

process.exit(exitCode)

function extractMdEndpoints(md: string) {
    const regex = /- \*\*([A-Z]+) ([^ \*\*]+)\*\*/g
    const endpoints = []
    let match
    while ((match = regex.exec(md)) !== null) {
        const method = match[1]
        let path = match[2]
        
        // Clean up path if it has trailing characters like period or dash
        path = path.replace(/[\-—\.]$/, '')
        
        endpoints.push({ method, path })
    }
    return endpoints
}
