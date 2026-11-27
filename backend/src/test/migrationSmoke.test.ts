import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM script shared with `npm run db:migrate:verify`
import { discoverMigrationFiles, verifyMigrations } from '../../scripts/verify-migrations.mjs'

interface MigrationFileInfo {
    version: string
    name: string
    hasDown: boolean
}

describe('migration files', () => {
    const files = discoverMigrationFiles() as MigrationFileInfo[]

    it('gives every migration a down file so the rollback boundary is defined', () => {
        expect(files.length).toBeGreaterThan(0)
        expect(files.filter((m) => !m.hasDown).map((m) => `${m.version}_${m.name}`)).toEqual([])
    })

    it('identifies migrations by version and name (versions may be shared, pairs may not)', () => {
        const keys = files.map((m) => `${m.version}_${m.name}`)
        expect(new Set(keys).size).toBe(keys.length)
    })

    it('orders migrations deterministically by version, then name', () => {
        const keys = files.map((m) => `${m.version}_${m.name}`)
        const sorted = [...files]
            .sort((a, b) => a.version.localeCompare(b.version, 'en') || a.name.localeCompare(b.name, 'en'))
            .map((m) => `${m.version}_${m.name}`)
        expect(keys).toEqual(sorted)
    })
})

// Needs a PostgreSQL server where databases may be created, e.g.
//   MIGRATION_VERIFY_DATABASE_URL=postgresql://user:pass@localhost:5432/postgres npm test -- migrationSmoke
const adminUrl = process.env.MIGRATION_VERIFY_DATABASE_URL?.trim()

describe.skipIf(!adminUrl)('postgres migration smoke check', () => {
    it('passes for an empty database, historical rows and interrupted migrations', async () => {
        const lines: string[] = []
        const result = await verifyMigrations({ adminUrl, log: (line: string) => lines.push(line) })
        expect(result.ok, lines.join('\n')).toBe(true)
        expect(result.summary.schemaVersion).toMatch(/^\d+$/)
    }, 600_000)
})
