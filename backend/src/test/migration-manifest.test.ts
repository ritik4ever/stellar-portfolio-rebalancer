import { describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, '..', 'db', 'migrations')
const manifestPath = join(migrationsDir, 'manifest.json')

interface ManifestEntry {
    file: string
    sha256: string
}

function checksum(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
}

describe('migration checksum manifest', () => {
    it('matches committed migration files', () => {
        const manifest = JSON.parse(
            readFileSync(manifestPath, 'utf8')
        ) as ManifestEntry[]

        expect(manifest.length).toBeGreaterThan(0)

        for (const entry of manifest) {
            const actualChecksum = checksum(
                join(migrationsDir, entry.file)
            )

            expect(actualChecksum).toBe(entry.sha256)
        }
    })
})