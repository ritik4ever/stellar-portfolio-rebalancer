#!/usr/bin/env node
/**
 * Versioned migration runner for PostgreSQL.
 * Usage:
 *   npm run db:migrate           - Apply all pending migrations
 *   npm run db:migrate -- --dry-run   - Show what would run without applying
 *   npm run db:migrate -- --rollback [n] - Roll back last n migrations (default 1)
 *   npm run db:migrate -- --status     - List applied and pending migrations
 *
 * Each migration (and each rollback) runs in a single transaction together with
 * its schema_migrations bookkeeping, so a migration is either fully applied and
 * recorded or not applied at all. See docs/MIGRATION.md ("Verifying migrations").
 *
 * MIGRATIONS_DIR (optional) overrides the directory that is scanned. It exists so
 * the smoke check (`npm run db:migrate:verify`) can inject deliberately broken
 * fixtures; leave it unset in normal use.
 */
import 'dotenv/config'
import { createHash } from 'crypto'
import { readFileSync, readdirSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'
import { getPool, closePool, isDbConfigured } from './client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR?.trim()
    ? resolve(process.env.MIGRATIONS_DIR.trim())
    : join(__dirname, 'migrations')
const MANIFEST_PATH = join(MIGRATIONS_DIR, 'manifest.json')

// A migration is identified by (version, name): several versions in this repo
// (009, 011, 013) intentionally have more than one migration, so `version` alone
// cannot be the primary key.
const MIGRATION_TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(64) NOT NULL,
    name VARCHAR(256) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (version, name)
);`

// Databases created before this change have PRIMARY KEY (version) only. Widen it
// in place; existing rows stay valid and the statement is a no-op afterwards.
const MIGRATION_TABLE_UPGRADE = `DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'schema_migrations'::regclass
          AND conname = 'schema_migrations_pkey'
          AND array_length(conkey, 1) = 1
    ) THEN
        ALTER TABLE schema_migrations DROP CONSTRAINT schema_migrations_pkey;
        ALTER TABLE schema_migrations ADD PRIMARY KEY (version, name);
    END IF;
END $$;`

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
    migrations.sort(compareMigrations)
    return migrations
}

/** Total order: version, then name, so migrations sharing a version are deterministic. */
function compareMigrations(
    a: { version: string; name: string },
    b: { version: string; name: string }
): number {
    return a.version.localeCompare(b.version, 'en') || a.name.localeCompare(b.name, 'en')
}

function migrationKey(m: { version: string; name: string }): string {
    return `${m.version}_${m.name}`
}

async function ensureMigrationsTable(): Promise<void> {
    await getPool().query(MIGRATION_TABLE)
    await getPool().query(MIGRATION_TABLE_UPGRADE)
}

async function getAppliedMigrations(): Promise<{ version: string; name: string }[]> {
    const result = await getPool().query<{ version: string; name: string }>(
        'SELECT version, name FROM schema_migrations'
    )
    return result.rows.sort(compareMigrations)
}

/**
 * Runs `sql` and the bookkeeping statement in one transaction so an interrupted
 * or failing migration leaves neither schema changes nor a schema_migrations row.
 */
async function runInTransaction(
    sql: string,
    bookkeeping: { text: string; values: string[] }
): Promise<void> {
    const client = await getPool().connect()
    try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query(bookkeeping.text, bookkeeping.values)
        await client.query('COMMIT')
    } catch (err) {
        try {
            await client.query('ROLLBACK')
        } catch {
            // connection already gone; the server discards the open transaction
        }
        throw err
    } finally {
        client.release()
    }
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
        const applied = await getAppliedMigrations()
        const appliedKeys = new Set(applied.map(migrationKey))

        if (status) {
            console.log('Applied migrations:')
            for (const a of applied) {
                const known = migrations.some((x) => migrationKey(x) === migrationKey(a))
                console.log('  ', a.version, known ? a.name : `${a.name} (unknown)`)
            }
            console.log('\nPending migrations:')
            const pending = migrations.filter((m) => !appliedKeys.has(migrationKey(m)))
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
                console.log('[DRY RUN] Would roll back:', toRollback.map(migrationKey).join(', '))
                for (const a of toRollback) {
                    const m = migrations.find((x) => migrationKey(x) === migrationKey(a))
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
            for (const a of toRollback) {
                const m = migrations.find((x) => migrationKey(x) === migrationKey(a))
                if (!m) {
                    console.error('Migration version not found:', migrationKey(a))
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
                await runInTransaction(downSql, {
                    text: 'DELETE FROM schema_migrations WHERE version = $1 AND name = $2',
                    values: [m.version, m.name]
                })
                console.log('Rolled back', m.version, m.name)
            }
            console.log('Rollback completed.')
            await closePool()
            process.exit(0)
        }

        const pending = migrations.filter((m) => !appliedKeys.has(migrationKey(m)))
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
            await runInTransaction(sql, {
                text: 'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
                values: [m.version, m.name]
            })
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