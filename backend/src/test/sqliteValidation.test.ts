import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateSqlitePragmas, logSqliteValidationReport } from '../db/sqliteValidation.js'
import type { PragmaCheckResult, SqliteValidationReport } from '../db/sqliteValidation.js'

// ── Mock better-sqlite3 Database ─────────────────────────────────────────────

function makeMockDb(pragmaValues: Record<string, unknown>) {
  return {
    prepare: (sql: string) => ({
      get: () => {
        const match = sql.match(/PRAGMA\s+(\w+)/i)
        if (!match) return undefined
        const key = match[1].toLowerCase()
        if (!(key in pragmaValues)) return undefined
        return { [key]: pragmaValues[key] }
      },
    }),
  }
}

// ── Mock logger ───────────────────────────────────────────────────────────────

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { logger } from '../utils/logger.js'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── validateSqlitePragmas ────────────────────────────────────────────────────

describe('validateSqlitePragmas', () => {
  it('returns allOk=true when all pragmas are correctly set', () => {
    const db = makeMockDb({
      journal_mode: 'wal',
      foreign_keys: 1,
      synchronous: 1,
      wal_autocheckpoint: 1000,
    })
    const report = validateSqlitePragmas(db as any, './data/test.db')
    expect(report.allOk).toBe(true)
    expect(report.checks.every((c) => c.ok)).toBe(true)
  })

  it('flags journal_mode != wal', () => {
    const db = makeMockDb({
      journal_mode: 'delete',
      foreign_keys: 1,
      synchronous: 1,
      wal_autocheckpoint: 1000,
    })
    const report = validateSqlitePragmas(db as any, './data/test.db')
    expect(report.allOk).toBe(false)
    const check = report.checks.find((c) => c.pragma === 'journal_mode')!
    expect(check.ok).toBe(false)
    expect(check.actionable).toMatch(/WAL mode is required/)
    expect(check.actionable).toMatch(/PRAGMA journal_mode = WAL/)
  })

  it('flags foreign_keys=0', () => {
    const db = makeMockDb({
      journal_mode: 'wal',
      foreign_keys: 0,
      synchronous: 1,
      wal_autocheckpoint: 1000,
    })
    const report = validateSqlitePragmas(db as any, './data/test.db')
    const check = report.checks.find((c) => c.pragma === 'foreign_keys')!
    expect(check.ok).toBe(false)
    expect(check.actionable).toMatch(/Referential integrity is not enforced/)
  })

  it('flags synchronous=OFF (0)', () => {
    const db = makeMockDb({
      journal_mode: 'wal',
      foreign_keys: 1,
      synchronous: 0,
      wal_autocheckpoint: 1000,
    })
    const report = validateSqlitePragmas(db as any, './data/test.db')
    const check = report.checks.find((c) => c.pragma === 'synchronous')!
    expect(check.ok).toBe(false)
    expect(check.actionable).toMatch(/risks database corruption/)
  })

  it('flags wal_autocheckpoint=0', () => {
    const db = makeMockDb({
      journal_mode: 'wal',
      foreign_keys: 1,
      synchronous: 1,
      wal_autocheckpoint: 0,
    })
    const report = validateSqlitePragmas(db as any, './data/test.db')
    const check = report.checks.find((c) => c.pragma === 'wal_autocheckpoint')!
    expect(check.ok).toBe(false)
    expect(check.actionable).toMatch(/WAL file will grow without bound/)
  })

  it('accepts synchronous=FULL (2)', () => {
    const db = makeMockDb({
      journal_mode: 'wal',
      foreign_keys: 1,
      synchronous: 2,
      wal_autocheckpoint: 1000,
    })
    const report = validateSqlitePragmas(db as any, './data/test.db')
    const check = report.checks.find((c) => c.pragma === 'synchronous')!
    expect(check.ok).toBe(true)
  })

  it('returns null actual for a pragma that throws', () => {
    const db = {
      prepare: () => ({
        get: () => { throw new Error('no such pragma') },
      }),
    }
    const report = validateSqlitePragmas(db as any, './data/test.db')
    expect(report.checks.every((c) => c.actual === null)).toBe(true)
  })

  it('includes dbPath in the report', () => {
    const db = makeMockDb({
      journal_mode: 'wal',
      foreign_keys: 1,
      synchronous: 1,
      wal_autocheckpoint: 1000,
    })
    const report = validateSqlitePragmas(db as any, '/custom/path/db.sqlite')
    expect(report.dbPath).toBe('/custom/path/db.sqlite')
  })
})

// ── logSqliteValidationReport ────────────────────────────────────────────────

describe('logSqliteValidationReport', () => {
  const passingReport: SqliteValidationReport = {
    allOk: true,
    dbPath: './data/test.db',
    checks: [
      { pragma: 'journal_mode', expected: 'wal', actual: 'wal', ok: true, actionable: '' },
      { pragma: 'foreign_keys', expected: 1, actual: 1, ok: true, actionable: '' },
      { pragma: 'synchronous', expected: 'NORMAL or FULL (1 or 2)', actual: 'NORMAL', ok: true, actionable: '' },
      { pragma: 'wal_autocheckpoint', expected: '>0 (default 1000)', actual: 1000, ok: true, actionable: '' },
    ],
  }

  it('logs info when all checks pass', () => {
    logSqliteValidationReport(passingReport)
    expect(logger.info).toHaveBeenCalledWith(
      '[DB] SQLite pragma validation passed',
      expect.objectContaining({ dbPath: './data/test.db' }),
    )
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('logs warn for non-critical pragma failure (journal_mode)', () => {
    const report: SqliteValidationReport = {
      allOk: false,
      dbPath: './data/test.db',
      checks: [
        { pragma: 'journal_mode', expected: 'wal', actual: 'delete', ok: false, actionable: 'fix journal_mode' },
        { pragma: 'foreign_keys', expected: 1, actual: 1, ok: true, actionable: '' },
        { pragma: 'synchronous', expected: 'NORMAL or FULL (1 or 2)', actual: 'NORMAL', ok: true, actionable: '' },
        { pragma: 'wal_autocheckpoint', expected: '>0 (default 1000)', actual: 1000, ok: true, actionable: '' },
      ],
    }
    logSqliteValidationReport(report)
    expect(logger.warn).toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('logs error for critical pragma failure (foreign_keys)', () => {
    const report: SqliteValidationReport = {
      allOk: false,
      dbPath: './data/test.db',
      checks: [
        { pragma: 'journal_mode', expected: 'wal', actual: 'wal', ok: true, actionable: '' },
        { pragma: 'foreign_keys', expected: 1, actual: 0, ok: false, actionable: 'fix fk' },
        { pragma: 'synchronous', expected: 'NORMAL or FULL (1 or 2)', actual: 'NORMAL', ok: true, actionable: '' },
        { pragma: 'wal_autocheckpoint', expected: '>0 (default 1000)', actual: 1000, ok: true, actionable: '' },
      ],
    }
    logSqliteValidationReport(report)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('critical SQLite pragma checks failed'),
      expect.any(Object),
    )
  })

  it('logs error for synchronous=OFF', () => {
    const report: SqliteValidationReport = {
      allOk: false,
      dbPath: './data/test.db',
      checks: [
        { pragma: 'journal_mode', expected: 'wal', actual: 'wal', ok: true, actionable: '' },
        { pragma: 'foreign_keys', expected: 1, actual: 1, ok: true, actionable: '' },
        { pragma: 'synchronous', expected: 'NORMAL or FULL (1 or 2)', actual: 'OFF', ok: false, actionable: 'fix sync' },
        { pragma: 'wal_autocheckpoint', expected: '>0 (default 1000)', actual: 1000, ok: true, actionable: '' },
      ],
    }
    logSqliteValidationReport(report)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('critical SQLite pragma checks failed'),
      expect.any(Object),
    )
  })
})
