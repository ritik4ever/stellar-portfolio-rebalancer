#!/usr/bin/env node
/**
 * Versioned migration runner for PostgreSQL.
 * Usage:
 *   npm run db:migrate           - Apply all pending migrations
 *   npm run db:migrate -- --dry-run   - Show what would run without applying
 *   npm run db:migrate -- --rollback [n] - Roll back last n migrations (default 1)
 *   npm run db:migrate -- --status     - List applied and pending migrations
 */
import 'dotenv/config'
import { createHash } from 'crypto'
import { readFileSync, readdirSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { getPool, closePool, isDbConfigured } from './client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, 'migrations')
const MANIFEST_PATH = join(MIGRATIONS_DIR, 'manifest.json')

const MIGRATION_TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(64) PRIMARY KEY,
    name VARCHAR(256) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`

interface MigrationFile {
    version: string
    name: string
    upPath: string
    downPath: string
}

interface MigrationManifestEntry {
    file: string
    sha256: string
}

function checksumFile(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function validateMigrationManifest(migrations: MigrationFile[]): void {
    const expectedFiles = migrations.flatMap((m) => [
        { file: `${m.version}_${m.name}.up.sql`, path: m.upPath },
        { file: `${m.version}_${m.name}.down.sql`, path: m.downPath }
    ])

    let manifest: MigrationManifestEntry[]

    try {
        manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as MigrationManifestEntry[]
    } catch {
        manifest = expectedFiles.map((entry) => ({
            file: entry.file,
            sha256: checksumFile(entry.path)
        }))

        writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
        console.log('Created migration checksum manifest:', MANIFEST_PATH)
        return
    }

    for (const entry of expectedFiles) {
        const manifestEntry = manifest.find((item) => item.file === entry.file)

        if (!manifestEntry) {
            throw new Error(`Migration checksum missing from manifest: ${entry.file}`)
        }

        const actual = checksumFile(entry.path)

        if (manifestEntry.sha256 !== actual) {
            throw new Error(
                `Migration checksum mismatch for ${entry.file}. ` +
                    'Committed migration file content changed after manifest generation.'
            )
        }
    }
}

function parseArgs(): { dryRun: boolean; rollback: number | null; status: boolean } {
    const args = process.argv.slice(2)
    let dryRun = false
    let rollback: number | null = null
    let status = false
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--dry-run') dryRun = true
        else if (args[i] === '--status') status = true
        else if (args[i] === '--rollback') {
            const next = args[i + 1]
            rollback = next !== undefined && /^\d+$/.test(next) ? parseInt(next, 10) : 1
            if (next !== undefined && /^\d+$/.test(next)) i++
        }
    }
    return { dryRun, rollback, status }
}

function discoverMigrations(): MigrationFile[] {
    const files = readdirSync(MIGRATIONS_DIR)
    const upFiles = files.filter((f) => f.endsWith('.up.sql'))
    const migrations: MigrationFile[] = []
    for (const up of upFiles) {
        const match = up.match(/^(\d+)_(.+)\.up\.sql$/)
        if (!match) continue
        const down = `${match[1]}_${match[2]}.down.sql`
        if (!files.includes(down)) {
            console.warn(`Warning: missing down migration ${down}`)
        }
        migrations.push({
            version: match[1],
            name: match[2],
            upPath: join(MIGRATIONS_DIR, up),
            downPath: join(MIGRATIONS_DIR, down)
        })
    }
    migrations.sort((a, b) => a.version.localeCompare(b.version, 'en'))
    return migrations
}

async function ensureMigrationsTable(): Promise<void> {
    await getPool().query(MIGRATION_TABLE)
}

async function getAppliedVersions(): Promise<string[]> {
    const result = await getPool().query<{ version: string }>(
        'SELECT version FROM schema_migrations ORDER BY version ASC'
    )
    return result.rows.map((r) => r.version)
}

async function run() {
    const { dryRun, rollback, status } = parseArgs()
    const migrations = discoverMigrations()
    validateMigrationManifest(migrations)

    if (migrations.length === 0) {
        console.log('No migration files found in', MIGRATIONS_DIR)
        process.exit(0)
    }

    if (!isDbConfigured()) {
        if (dryRun && rollback === null && !status) {
            console.log('[DRY RUN] DATABASE_URL not set. Showing migration files that would be applied:')
            for (const m of migrations) {
                console.log('  ', m.version, m.name)
            }
            console.log('Total:', migrations.length, 'migration(s).')
            process.exit(0)
        }
        console.error('DATABASE_URL is not set. Set it to run migrations.')
        process.exit(1)
    }

    try {
        await ensureMigrationsTable()
        const applied = await getAppliedVersions()

        if (status) {
            console.log('Applied migrations:')
            for (const v of applied) {
                const m = migrations.find((x) => x.version === v)
                console.log('  ', v, m ? m.name : '(unknown)')
            }
            console.log('\nPending migrations:')
            const pending = migrations.filter((m) => !applied.includes(m.version))
            for (const m of pending) {
                console.log('  ', m.version, m.name)
            }
            await closePool()
            process.exit(0)
            return
        }

        if (rollback !== null) {
            const toRollback = applied.slice(-rollback).reverse()
            if (toRollback.length === 0) {
                console.log('No migrations to roll back.')
                await closePool()
                process.exit(0)
                return
            }
            if (dryRun) {
                console.log('[DRY RUN] Would roll back:', toRollback.join(', '))
                for (const v of toRollback) {
                    const m = migrations.find((x) => x.version === v)
                    if (m) {
                        try {
                            const sql = readFileSync(m.downPath, 'utf8')
                            console.log('---', m.version, m.name, '(down) ---\n', sql)
                        } catch {
                            console.log('---', m.version, m.name, '(down file missing) ---')
                        }
                    }
                }
                await closePool()
                process.exit(0)
            }
            for (const v of toRollback) {
                const m = migrations.find((x) => x.version === v)
                if (!m) {
                    console.error('Migration version not found:', v)
                    process.exit(1)
                }
                let downSql: string
                try {
                    downSql = readFileSync(m.downPath, 'utf8')
                } catch (err) {
                    console.error('Cannot read down migration', m.downPath, err)
                    process.exit(1)
                }
                console.log('Rolling back', m.version, m.name, '...')
                await getPool().query(downSql)
                await getPool().query('DELETE FROM schema_migrations WHERE version = $1', [m.version])
                console.log('Rolled back', m.version, m.name)
            }
            console.log('Rollback completed.')
            await closePool()
            process.exit(0)
        }

        const pending = migrations.filter((m) => !applied.includes(m.version))
        if (pending.length === 0) {
            console.log('No pending migrations.')
            await closePool()
            process.exit(0)
        }

        if (dryRun) {
            console.log('[DRY RUN] Pending migrations (not applied):')
            for (const m of pending) {
                const sql = readFileSync(m.upPath, 'utf8')
                console.log(
                    '---',
                    m.version,
                    m.name,
                    '---\n',
                    sql.substring(0, 500) + (sql.length > 500 ? '...' : ''),
                    '\n'
                )
            }
            console.log('Total:', pending.length, 'migration(s). Run without --dry-run to apply.')
            await closePool()
            process.exit(0)
        }

        for (const m of pending) {
            const sql = readFileSync(m.upPath, 'utf8')
            console.log('Applying', m.version, m.name, '...')
            await getPool().query(sql)
            await getPool().query(
                'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
                [m.version, m.name]
            )
            console.log('Applied', m.version, m.name)
        }
        console.log('Migrations completed successfully.')
    } catch (err) {
        console.error('Migration failed:', err)
        process.exit(1)
    } finally {
        await closePool()
    }
}

run()