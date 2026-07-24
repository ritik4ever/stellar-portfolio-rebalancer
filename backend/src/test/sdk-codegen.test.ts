import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import packageJson from '../../package.json' with { type: 'json' }

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('SDK codegen setup (#887)', () => {
    it('sdk:generate script is defined in package.json', () => {
        expect(packageJson.scripts['sdk:generate']).toBeDefined()
        expect(packageJson.scripts['sdk:generate']).toContain('generate-sdk')
    })

    it('generate-sdk.ts script file exists', () => {
        const scriptPath = resolve(__dirname, '..', '..', 'scripts', 'generate-sdk.ts')
        expect(existsSync(scriptPath)).toBe(true)
    })

    it('openapi-typescript is listed as a dev dependency', () => {
        expect(packageJson.devDependencies['openapi-typescript']).toBeDefined()
    })

    it('frontend/src/api/generated directory is tracked in git (.gitkeep)', () => {
        const gitkeepPath = resolve(
            __dirname,
            '..', '..', '..', 'frontend', 'src', 'api', 'generated', '.gitkeep'
        )
        expect(existsSync(gitkeepPath)).toBe(true)
    })
})
