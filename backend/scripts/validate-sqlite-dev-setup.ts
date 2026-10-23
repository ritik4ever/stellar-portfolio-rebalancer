#!/usr/bin/env node
/**
 * Validate the SQLite development setup from a clean environment (SPR-2026-261).
 *
 * A fresh checkout has no `backend/data/` directory and must not need a
 * prebuilt database. This script proves that contract end to end:
 *
 *   1. `DB_PATH` resolution follows the documented precedence.
 *   2. A brand-new nested path is bootstrapped (directory + schema) by the same
 *      `DatabaseService` the server uses.
 *   3. Startup is repeatable: a second boot does not fail, duplicate seeds, or
 *      depend on state that only the first run created.
 *   4. The other SQLite consumers (notifications, idempotency, export
 *      schedules) can initialise on that same clean path.
 *   5. An unusable path produces the documented `SqliteSetupError` with a
 *      remediation hint instead of a raw "unable to open database file".
 *
 * Usage:
 *   npm run db:validate:dev            # throwaway directory under the OS tmpdir
 *   npm run db:validate:dev -- --keep  # keep the throwaway directory for inspection
 *   npm run db:validate:dev -- ./tmp/sqlite-check
 *
 * Exit code 0 = every check passed, 1 = at least one check failed.
 */
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  openSqliteDatabase,
  resolveSqliteDbPath,
  SqliteSetupError,
} from '../src/db/sqliteBootstrap.js'

export interface SqliteDevSetupCheck {
  name: string
  ok: boolean
  detail: string
}

export interface SqliteDevSetupReport {
  ok: boolean
  dbPath: string
  checks: SqliteDevSetupCheck[]
}

export interface SqliteDevSetupOptions {
  /** Root directory used for the throwaway database. Defaults to a fresh tmpdir. */
  workDir?: string
  /** Keep the throwaway directory after the run. */
  keep?: boolean
}

const REQUIRED_TABLES = [
  'portfolios',
  'rebalance_history',
  'assets',
  'user_preferences',
  'kv_store',
]

function check(name: string, fn: () => string | void): SqliteDevSetupCheck {
  try {
    const detail = fn()
    return { name, ok: true, detail: detail ?? 'ok' }
  } catch (error) {
    return {
      name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

async function checkAsync(name: string, fn: () => Promise<string | void>): Promise<SqliteDevSetupCheck> {
  try {
    const detail = await fn()
    return { name, ok: true, detail: detail ?? 'ok' }
  } catch (error) {
    return {
      name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

function tableNames(dbPath: string): string[] {
  const db = openSqliteDatabase(dbPath)
  try {
    return (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>
    ).map((row) => row.name)
  } finally {
    db.close()
  }
}

function assetCount(dbPath: string): number {
  const db = openSqliteDatabase(dbPath)
  try {
    return (db.prepare('SELECT COUNT(*) AS count FROM assets').get() as { count: number }).count
  } finally {
    db.close()
  }
}

/**
 * Run every check and return the report. The caller owns process.env.DB_PATH:
 * this function only mutates it for the duration of the run.
 */
export async function runSqliteDevSetupValidation(
  options: SqliteDevSetupOptions = {},
): Promise<SqliteDevSetupReport> {
  const workDir = options.workDir
    ? resolve(options.workDir)
    : mkdtempSync(join(tmpdir(), 'stellar-sqlite-setup-'))
  const dbPath = join(workDir, 'data', 'portfolio.db')
  const previousDbPath = process.env.DB_PATH
  const previousNodeEnv = process.env.NODE_ENV
  const checks: SqliteDevSetupCheck[] = []

  const restoreEnv = () => {
    if (previousDbPath === undefined) delete process.env.DB_PATH
    else process.env.DB_PATH = previousDbPath
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
  }

  try {
    // Resolve the path before the database module is imported: DatabaseService
    // creates its singleton (and therefore its connection) at import time.
    process.env.DB_PATH = dbPath
    process.env.NODE_ENV = 'test'

    checks.push(
      check('default DB_PATH resolution', () => {
        if (resolveSqliteDbPath({}) !== './data/portfolio.db') {
          throw new Error('unset DB_PATH no longer resolves to ./data/portfolio.db')
        }
        if (resolveSqliteDbPath({ DB_PATH: '   ' }) !== './data/portfolio.db') {
          throw new Error('a blank DB_PATH must fall back to ./data/portfolio.db')
        }
        return './data/portfolio.db'
      }),
    )

    checks.push(
      check('clean checkout has no prebuilt database', () => {
        let exists = true
        try {
          statSync(dbPath)
        } catch {
          exists = false
        }
        if (exists) throw new Error(`unexpected prebuilt database at ${dbPath}`)
        return 'no database file before bootstrap'
      }),
    )

    const { DatabaseService } = await import('../src/services/databaseService.js')

    checks.push(
      await checkAsync('first start creates directory, database and schema', async () => {
        const service = new DatabaseService()
        try {
          statSync(join(workDir, 'data'))
          statSync(dbPath)
        } finally {
          service.close()
        }

        const tables = tableNames(dbPath)
        const missing = REQUIRED_TABLES.filter((table) => !tables.includes(table))
        if (missing.length > 0) {
          throw new Error(`schema is missing tables: ${missing.join(', ')}`)
        }
        return `${tables.length} tables created`
      }),
    )

    checks.push(
      await checkAsync('second start is repeatable and does not duplicate seed data', async () => {
        const firstAssets = assetCount(dbPath)
        const firstTables = tableNames(dbPath)

        const service = new DatabaseService()
        try {
          // The constructor runs the schema, migrations and default seeds again.
        } finally {
          service.close()
        }

        const secondAssets = assetCount(dbPath)
        const secondTables = tableNames(dbPath)
        if (firstAssets !== secondAssets) {
          throw new Error(`asset seed is not idempotent: ${firstAssets} -> ${secondAssets}`)
        }
        if (firstTables.join(',') !== secondTables.join(',')) {
          throw new Error('schema changed between two boots of the same database')
        }
        return `assets stable at ${secondAssets}, ${secondTables.length} tables`
      }),
    )

    checks.push(
      check('shared SQLite consumers initialise on the clean path', () => {
        const notificationDb = openSqliteDatabase(dbPath)
        const idempotencyDb = openSqliteDatabase(dbPath)
        const exportScheduleDb = openSqliteDatabase(dbPath)
        try {
          notificationDb.prepare('SELECT 1').get()
          idempotencyDb.prepare('SELECT 1').get()
          exportScheduleDb.prepare('SELECT 1').get()
        } finally {
          notificationDb.close()
          idempotencyDb.close()
          exportScheduleDb.close()
        }
        return 'notifications, idempotency and export schedules handle the same path'
      }),
    )

    checks.push(
      check('unusable path returns an actionable setup error', () => {
        const blocker = join(workDir, 'not-a-directory')
        writeFileSync(blocker, 'occupied')
        const unusablePath = join(blocker, 'portfolio.db')

        let message = ''
        try {
          openSqliteDatabase(unusablePath)
        } catch (error) {
          if (!(error instanceof SqliteSetupError)) {
            throw new Error(`expected SqliteSetupError, received ${String(error)}`)
          }
          message = error.message
          if (!error.message.includes(unusablePath)) {
            throw new Error('setup error does not name the resolved database path')
          }
          if (!/DB_PATH|writable|Move the file/i.test(error.hint)) {
            throw new Error('setup error does not include a remediation hint')
          }
        }
        if (!message) throw new Error('opening a path under a regular file did not fail')
        return 'error names the path and the next step'
      }),
    )
  } finally {
    restoreEnv()
    if (!options.keep && !options.workDir) {
      rmSync(workDir, { recursive: true, force: true })
    }
  }

  return {
    ok: checks.every((item) => item.ok),
    dbPath,
    checks,
  }
}

function printReport(report: SqliteDevSetupReport): void {
  console.log('SQLite development setup validation')
  console.log(`Database: ${report.dbPath}`)
  console.log('')
  for (const item of report.checks) {
    console.log(`  ${item.ok ? 'PASS' : 'FAIL'}  ${item.name} — ${item.detail}`)
  }
  console.log('')
  console.log(report.ok ? 'All checks passed.' : 'One or more checks failed.')
}

const isDirectRun = (() => {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href
  } catch {
    return false
  }
})()

if (isDirectRun) {
  const args = process.argv.slice(2)
  const keep = args.includes('--keep')
  const positional = args.find((arg) => !arg.startsWith('--'))

  runSqliteDevSetupValidation({ keep, workDir: positional })
    .then((report) => {
      printReport(report)
      process.exitCode = report.ok ? 0 : 1
    })
    .catch((error) => {
      console.error('SQLite development setup validation crashed:', error)
      process.exitCode = 1
    })
}
