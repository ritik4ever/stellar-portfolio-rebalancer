#!/usr/bin/env node
/**
 * Repeatable PostgreSQL migration smoke check (issue #2184).
 *
 * Creates throwaway databases on the server named by MIGRATION_VERIFY_DATABASE_URL
 * (falls back to DATABASE_URL), drives the real runner (`src/db/migrate.ts`) as a
 * subprocess against them, and reports the schema version and rollback boundary.
 * The runner is executed with a scrubbed environment (no PG* variables, no .env)
 * so the result does not depend on whatever the maintainer's shell contains.
 *
 * Scenarios:
 *   1. empty database          - fresh apply, idempotent re-run, rollback boundary round trip
 *   2. historical rows         - older schema holding data is migrated forward without loss
 *   3. interrupted migration   - (a) schema applied but never recorded, (b) a failing
 *                                migration leaves nothing behind, (c) a legacy
 *                                schema_migrations table (PRIMARY KEY (version)) is upgraded
 *
 * Usage (from backend/):
 *   MIGRATION_VERIFY_DATABASE_URL=postgresql://user:pass@localhost:5432/postgres \
 *     npm run db:migrate:verify
 *
 * The role needs CREATEDB. Nothing outside the throwaway databases is touched.
 */
import { spawn } from 'node:child_process'
import {
    copyFileSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pg from 'pg'

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = join(backendDir, 'src', 'db', 'migrations')
const RUN_TIMEOUT_MS = 120_000

// ---------------------------------------------------------------------------
// migration file helpers (mirror the runner's discovery and ordering rules)
// ---------------------------------------------------------------------------

function compareMigrations(a, b) {
    return a.version.localeCompare(b.version, 'en') || a.name.localeCompare(b.name, 'en')
}

const keyOf = (m) => `${m.version}_${m.name}`

export function discoverMigrationFiles(dir = migrationsDir) {
    const files = readdirSync(dir)
    const migrations = []
    for (const up of files.filter((f) => f.endsWith('.up.sql'))) {
        const match = up.match(/^(\d+)_(.+)\.up\.sql$/)
        if (!match) continue
        migrations.push({
            version: match[1],
            name: match[2],
            hasDown: files.includes(`${match[1]}_${match[2]}.down.sql`)
        })
    }
    return migrations.sort(compareMigrations)
}

// ---------------------------------------------------------------------------
// database helpers
// ---------------------------------------------------------------------------

function withDatabase(url, database) {
    const u = new URL(url)
    u.pathname = `/${database}`
    return u.toString()
}

async function withClient(url, fn) {
    const client = new pg.Client({ connectionString: url })
    await client.connect()
    try {
        return await fn(client)
    } finally {
        await client.end()
    }
}

let dbCounter = 0
async function createScratchDatabase(adminUrl) {
    const name = `migration_verify_${process.pid}_${Date.now().toString(36)}_${dbCounter++}`
    await withClient(adminUrl, (c) => c.query(`CREATE DATABASE "${name}"`))
    return {
        name,
        url: withDatabase(adminUrl, name),
        async drop() {
            await withClient(adminUrl, async (c) => {
                try {
                    await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
                } catch {
                    await c.query(`DROP DATABASE IF EXISTS "${name}"`)
                }
            })
        }
    }
}

/** Structural fingerprint of the public schema, excluding migration bookkeeping. */
async function schemaSnapshot(url) {
    return withClient(url, async (c) => {
        const cols = await c.query(
            `SELECT table_name, column_name, data_type, is_nullable, column_default
               FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name <> 'schema_migrations'
              ORDER BY table_name, column_name`
        )
        const idx = await c.query(
            `SELECT indexname, indexdef FROM pg_indexes
              WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
              ORDER BY indexname`
        )
        return JSON.stringify({ columns: cols.rows, indexes: idx.rows })
    })
}

async function appliedRows(url) {
    return withClient(url, async (c) => {
        const exists = await c.query(`SELECT to_regclass('public.schema_migrations') AS t`)
        if (!exists.rows[0].t) return null
        const res = await c.query('SELECT version, name FROM schema_migrations')
        return res.rows.sort(compareMigrations)
    })
}

const schemaVersionOf = (rows) => (rows && rows.length ? rows[rows.length - 1].version : null)

// ---------------------------------------------------------------------------
// running the real migration runner
// ---------------------------------------------------------------------------

function runMigrate(databaseUrl, args = [], { dir } = {}) {
    // Scrubbed environment: only DATABASE_URL selects the target. PG*/DB_* variables
    // would take precedence over it inside the runner, and a developer .env must not leak in.
    const env = {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? tmpdir(),
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
        DOTENV_CONFIG_PATH: process.platform === 'win32' ? 'NUL' : '/dev/null'
    }
    if (dir) env.MIGRATIONS_DIR = dir

    return new Promise((resolvePromise, reject) => {
        const child = spawn(
            process.execPath,
            ['--import', 'tsx', 'src/db/migrate.ts', ...args],
            { cwd: backendDir, env, stdio: ['ignore', 'pipe', 'pipe'] }
        )
        let stdout = ''
        let stderr = ''
        const timer = setTimeout(() => {
            child.kill('SIGKILL')
            reject(new Error(`migrate ${args.join(' ')} timed out after ${RUN_TIMEOUT_MS}ms`))
        }, RUN_TIMEOUT_MS)
        child.stdout.on('data', (d) => (stdout += d))
        child.stderr.on('data', (d) => (stderr += d))
        child.on('error', (err) => {
            clearTimeout(timer)
            reject(err)
        })
        child.on('close', (code) => {
            clearTimeout(timer)
            resolvePromise({ code, stdout, stderr })
        })
    })
}

function pendingFromStatus(stdout) {
    const idx = stdout.indexOf('Pending migrations:')
    if (idx === -1) return null
    return stdout
        .slice(idx + 'Pending migrations:'.length)
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
}

// ---------------------------------------------------------------------------
// scenario plumbing
// ---------------------------------------------------------------------------

class Checks {
    constructor() {
        this.failures = []
        this.passed = 0
    }
    ok(condition, message) {
        if (condition) this.passed++
        else this.failures.push(message)
    }
    eq(actual, expected, message) {
        this.ok(
            JSON.stringify(actual) === JSON.stringify(expected),
            `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`
        )
    }
}

function tail(text, lines = 6) {
    return text.trim().split('\n').slice(-lines).join('\n')
}

async function mustMigrate(db, args, checks, label, opts) {
    const res = await runMigrate(db.url, args, opts)
    checks.ok(res.code === 0, `${label}: expected exit 0, got ${res.code}\n${tail(res.stderr || res.stdout)}`)
    return res
}

// ---------------------------------------------------------------------------
// scenarios
// ---------------------------------------------------------------------------

async function scenarioFiles(ctx) {
    const checks = new Checks()
    const files = ctx.files
    checks.ok(files.length > 0, 'no migration files found')
    checks.eq(
        files.filter((m) => !m.hasDown).map(keyOf),
        [],
        'every migration needs a .down.sql (it defines the rollback boundary)'
    )
    checks.eq(new Set(files.map(keyOf)).size, files.length, 'migration identities (version_name) must be unique')

    const manifest = JSON.parse(readFileSync(join(migrationsDir, 'manifest.json'), 'utf8'))
    const stale = []
    for (const entry of manifest) {
        const sum = createHash('sha256').update(readFileSync(join(migrationsDir, entry.file))).digest('hex')
        if (sum !== entry.sha256) stale.push(entry.file)
    }
    checks.eq(stale, [], 'manifest.json checksums must match the committed migration files')
    const listed = new Set(manifest.map((e) => e.file))
    const unlisted = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql') && !listed.has(f))
    checks.eq(unlisted, [], 'every .sql file must appear in manifest.json')
    return checks
}

async function scenarioEmpty(ctx) {
    const checks = new Checks()
    const db = await createScratchDatabase(ctx.adminUrl)
    try {
        checks.eq(await appliedRows(db.url), null, 'empty database must start without schema_migrations')

        await mustMigrate(db, [], checks, 'apply on empty database')
        const rows = await appliedRows(db.url)
        checks.eq((rows ?? []).map(keyOf), ctx.files.map(keyOf), 'every migration file must be recorded exactly once, in order')
        checks.eq(schemaVersionOf(rows), ctx.latest.version, 'schema version must equal the latest migration version')

        const status = await mustMigrate(db, ['--status'], checks, '--status after apply')
        checks.eq(pendingFromStatus(status.stdout), [], '--status must report nothing pending')

        const full = await schemaSnapshot(db.url)
        const again = await mustMigrate(db, [], checks, 'second apply')
        checks.ok(/No pending migrations/.test(again.stdout), 'second apply must be a no-op')
        checks.eq(await schemaSnapshot(db.url), full, 'second apply must not change the schema')

        // rollback boundary: step back exactly one migration and forward again
        const previous = ctx.files[ctx.files.length - 2]
        await mustMigrate(db, ['--rollback', '1'], checks, 'rollback 1')
        const afterRollback = await appliedRows(db.url)
        checks.eq(
            (afterRollback ?? []).map(keyOf),
            ctx.files.slice(0, -1).map(keyOf),
            'rollback 1 must remove exactly the newest migration'
        )
        checks.eq(schemaVersionOf(afterRollback), previous.version, 'schema version after rollback 1 must be the previous migration')
        await mustMigrate(db, [], checks, 're-apply after rollback')
        checks.eq(await schemaSnapshot(db.url), full, 'rollback 1 then re-apply must restore the identical schema')

        ctx.boundary = { newest: keyOf(ctx.latest), previous: keyOf(previous) }
    } finally {
        await db.drop()
    }
    return checks
}

async function scenarioHistoricalRows(ctx) {
    const checks = new Checks()
    const db = await createScratchDatabase(ctx.adminUrl)
    try {
        // Bring the database to an older release: migrations 001-002 applied, the rest not.
        const keep = ctx.files.filter((m) => m.version <= '002')
        const newer = ctx.files.length - keep.length
        checks.ok(newer > 0, 'scenario needs migrations newer than 002')
        await mustMigrate(db, [], checks, 'initial apply')
        await mustMigrate(db, ['--rollback', String(newer)], checks, `roll back to version 002 (${newer} migrations)`)
        checks.eq((await appliedRows(db.url) ?? []).map(keyOf), keep.map(keyOf), 'database must sit at the older schema version')

        // Historical data written by that older release.
        await withClient(db.url, async (c) => {
            await c.query(
                `INSERT INTO portfolios (id, user_address, allocations, threshold, balances, total_value)
                 VALUES ('hist-1', 'GHIST1', '{"XLM":60,"USDC":40}', 5, '{"XLM":600,"USDC":400}', 1000),
                        ('hist-2', 'GHIST2', '{"XLM":50,"BTC":50}', 10, '{"XLM":500,"BTC":0.01}', 2500)`
            )
            await c.query(
                `INSERT INTO rebalance_events (id, portfolio_id, trigger, trades, gas_used, status, is_automatic)
                 VALUES ('hist-evt-1', 'hist-1', 'Threshold exceeded (6.1%)', 2, '0.01 XLM', 'completed', TRUE),
                        ('hist-evt-2', 'hist-1', 'Manual', 0, '', 'failed', FALSE),
                        ('hist-evt-3', 'hist-2', 'Threshold exceeded (11.4%)', 3, '0.02 XLM', 'completed', TRUE)`
            )
        })
        const fingerprint = () =>
            withClient(db.url, async (c) => {
                const p = await c.query(
                    `SELECT id, user_address, allocations::text AS a, threshold, balances::text AS b, total_value::text AS v
                       FROM portfolios ORDER BY id`
                )
                const e = await c.query(
                    `SELECT id, portfolio_id, trigger, trades, gas_used, status, is_automatic
                       FROM rebalance_events ORDER BY id`
                )
                return JSON.stringify({ p: p.rows, e: e.rows })
            })
        const before = await fingerprint()

        await mustMigrate(db, [], checks, 'migrate forward over historical rows')
        const rows = await appliedRows(db.url)
        checks.eq((rows ?? []).map(keyOf), ctx.files.map(keyOf), 'all migrations must be recorded after migrating forward')
        checks.eq(schemaVersionOf(rows), ctx.latest.version, 'schema version must reach the latest migration')
        checks.eq(await fingerprint(), before, 'historical rows must be unchanged by the forward migration')
    } finally {
        await db.drop()
    }
    return checks
}

async function scenarioInterrupted(ctx) {
    const checks = new Checks()

    // (a) schema changes landed but the process died before recording them
    {
        const db = await createScratchDatabase(ctx.adminUrl)
        try {
            await mustMigrate(db, [], checks, '(a) initial apply')
            const full = await schemaSnapshot(db.url)
            await withClient(db.url, (c) =>
                c.query('DELETE FROM schema_migrations WHERE version = $1 AND name = $2', [ctx.latest.version, ctx.latest.name])
            )
            checks.eq(
                schemaVersionOf(await appliedRows(db.url)),
                ctx.files[ctx.files.length - 2].version,
                '(a) simulated crash must leave the newest migration unrecorded'
            )
            await mustMigrate(db, [], checks, '(a) recovery run')
            checks.eq((await appliedRows(db.url) ?? []).map(keyOf), ctx.files.map(keyOf), '(a) recovery must record the missing migration')
            checks.eq(await schemaSnapshot(db.url), full, '(a) re-applying an already-applied migration must not change the schema')
        } finally {
            await db.drop()
        }
    }

    // (b) a failing migration must leave neither partial schema nor a version row
    {
        const db = await createScratchDatabase(ctx.adminUrl)
        const dir = mkdtempSync(join(tmpdir(), 'migration-verify-'))
        try {
            const base = ctx.files.slice(0, 3)
            for (const m of base) {
                for (const kind of ['up', 'down']) {
                    const f = `${m.version}_${m.name}.${kind}.sql`
                    copyFileSync(join(migrationsDir, f), join(dir, f))
                }
            }
            const fixture = '900_interrupted_fixture'
            writeFileSync(
                join(dir, `${fixture}.up.sql`),
                'CREATE TABLE smoke_partial (id INTEGER PRIMARY KEY);\n' +
                    'INSERT INTO smoke_table_that_does_not_exist VALUES (1);\n'
            )
            writeFileSync(join(dir, `${fixture}.down.sql`), 'DROP TABLE IF EXISTS smoke_partial;\n')

            const failed = await runMigrate(db.url, [], { dir })
            checks.ok(failed.code !== 0, '(b) a migration with a failing statement must exit non-zero')
            checks.eq(
                (await appliedRows(db.url) ?? []).map(keyOf),
                base.map(keyOf),
                '(b) the failed migration must not be recorded'
            )
            const leftover = await withClient(db.url, (c) => c.query(`SELECT to_regclass('public.smoke_partial') AS t`))
            checks.eq(leftover.rows[0].t, null, '(b) statements before the failure must be rolled back (no partial schema)')

            // Fix the migration and retry: the half-finished attempt must not block recovery.
            writeFileSync(join(dir, `${fixture}.up.sql`), 'CREATE TABLE smoke_partial (id INTEGER PRIMARY KEY);\n')
            rmSync(join(dir, 'manifest.json'), { force: true }) // checksums were generated for the broken file
            const retry = await runMigrate(db.url, [], { dir })
            checks.ok(retry.code === 0, `(b) retry after fixing the migration must succeed\n${tail(retry.stderr || retry.stdout)}`)
            checks.eq(
                (await appliedRows(db.url) ?? []).map(keyOf),
                [...base.map(keyOf), fixture],
                '(b) retry must record the fixed migration'
            )
        } finally {
            rmSync(dir, { recursive: true, force: true })
            await db.drop()
        }
    }

    // (c) database created by the older runner: schema_migrations has PRIMARY KEY (version)
    {
        const db = await createScratchDatabase(ctx.adminUrl)
        try {
            await mustMigrate(db, [], checks, '(c) initial apply')
            const full = await schemaSnapshot(db.url)
            await withClient(db.url, async (c) => {
                await c.query('DELETE FROM schema_migrations a USING schema_migrations b WHERE a.version = b.version AND a.name > b.name')
                await c.query('ALTER TABLE schema_migrations DROP CONSTRAINT schema_migrations_pkey')
                await c.query('ALTER TABLE schema_migrations ADD PRIMARY KEY (version)')
            })
            const legacy = await appliedRows(db.url)
            checks.ok((legacy ?? []).length < ctx.files.length, '(c) legacy fixture must be missing the duplicate-version migrations')

            await mustMigrate(db, [], checks, '(c) migrate a legacy schema_migrations table')
            checks.eq((await appliedRows(db.url) ?? []).map(keyOf), ctx.files.map(keyOf), '(c) every migration must be recorded after the upgrade')
            const pk = await withClient(db.url, (c) =>
                c.query(
                    `SELECT array_length(conkey, 1) AS cols FROM pg_constraint
                      WHERE conrelid = 'schema_migrations'::regclass AND contype = 'p'`
                )
            )
            checks.eq(pk.rows.map((r) => r.cols), [2], '(c) primary key must be widened to (version, name)')
            checks.eq(await schemaSnapshot(db.url), full, '(c) the upgrade must not change the application schema')
        } finally {
            await db.drop()
        }
    }
    return checks
}

// ---------------------------------------------------------------------------
// public entry point
// ---------------------------------------------------------------------------

export async function verifyMigrations({ adminUrl, log = console.log } = {}) {
    if (!adminUrl) {
        throw new Error('Set MIGRATION_VERIFY_DATABASE_URL (or DATABASE_URL) to a PostgreSQL server where databases may be created.')
    }
    const files = discoverMigrationFiles()
    const ctx = { adminUrl, files, latest: files[files.length - 1], boundary: null }

    const scenarios = [
        ['migration files are consistent', scenarioFiles],
        ['empty database', scenarioEmpty],
        ['database with historical rows', scenarioHistoricalRows],
        ['interrupted schema migration', scenarioInterrupted]
    ]

    const results = []
    for (const [name, fn] of scenarios) {
        let checks
        try {
            checks = await fn(ctx)
        } catch (err) {
            checks = new Checks()
            checks.failures.push(`unexpected error: ${err instanceof Error ? err.message : String(err)}`)
        }
        const ok = checks.failures.length === 0
        results.push({ name, ok, passed: checks.passed, failures: checks.failures })
        log(`${ok ? 'PASS' : 'FAIL'}  ${name} (${checks.passed} checks)`)
        for (const f of checks.failures) log(`        - ${f.replace(/\n/g, '\n          ')}`)
    }

    const ok = results.every((r) => r.ok)
    const summary = {
        migrations: files.length,
        schemaVersion: ctx.latest?.version ?? null,
        rollbackBoundary: ctx.boundary
    }
    if (ok) {
        log('')
        log(`Schema version:    ${summary.schemaVersion} (${summary.migrations} migrations)`)
        if (summary.rollbackBoundary) {
            log(`Rollback boundary: ${summary.rollbackBoundary.newest} -> ${summary.rollbackBoundary.previous}`)
        }
    }
    return { ok, results, summary }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) {
    const adminUrl = process.env.MIGRATION_VERIFY_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim()
    verifyMigrations({ adminUrl })
        .then(({ ok }) => process.exit(ok ? 0 : 1))
        .catch((err) => {
            console.error(err instanceof Error ? err.message : err)
            process.exit(1)
        })
}
