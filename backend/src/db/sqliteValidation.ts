import type Database from 'better-sqlite3'
import { logger } from '../utils/logger.js'

export interface PragmaCheckResult {
  pragma: string
  expected: string | number
  actual: string | number | null
  ok: boolean
  actionable: string
}

export interface SqliteValidationReport {
  allOk: boolean
  checks: PragmaCheckResult[]
  dbPath: string
}

/**
 * Inspects critical SQLite pragmas on startup and returns a structured report.
 * Does NOT throw — callers decide whether to hard-fail or warn.
 */
export function validateSqlitePragmas(
  db: Database.Database,
  dbPath: string,
): SqliteValidationReport {
  const checks: PragmaCheckResult[] = []

  // ── WAL mode ────────────────────────────────────────────────────────────
  const journalMode = pragmaStr(db, 'journal_mode')
  checks.push({
    pragma: 'journal_mode',
    expected: 'wal',
    actual: journalMode,
    ok: journalMode === 'wal',
    actionable:
      journalMode === 'wal'
        ? ''
        : `journal_mode is '${journalMode}' instead of 'wal'. ` +
          `WAL mode is required for concurrent reads during writes. ` +
          `Run: PRAGMA journal_mode = WAL; on the database, or delete the file at '${dbPath}' to recreate it.`,
  })

  // ── Foreign keys ─────────────────────────────────────────────────────────
  const foreignKeys = pragmaInt(db, 'foreign_keys')
  checks.push({
    pragma: 'foreign_keys',
    expected: 1,
    actual: foreignKeys,
    ok: foreignKeys === 1,
    actionable:
      foreignKeys === 1
        ? ''
        : `foreign_keys is OFF. Referential integrity is not enforced. ` +
          `This is set automatically at startup; if you see this warning the ` +
          `PRAGMA was overridden. Check for competing connections or attached extensions.`,
  })

  // ── Synchronous mode ─────────────────────────────────────────────────────
  // Expected: NORMAL (1) in WAL mode. FULL (2) is safe but slower.
  // OFF (0) risks data loss on crash.
  const synchronous = pragmaInt(db, 'synchronous')
  const syncOk = synchronous !== null && synchronous >= 1
  const syncLabel: Record<number, string> = { 0: 'OFF', 1: 'NORMAL', 2: 'FULL', 3: 'EXTRA' }
  checks.push({
    pragma: 'synchronous',
    expected: 'NORMAL or FULL (1 or 2)',
    actual: synchronous !== null ? (syncLabel[synchronous] ?? String(synchronous)) : null,
    ok: syncOk,
    actionable: syncOk
      ? ''
      : `synchronous is OFF (0). This risks database corruption on power loss or crash. ` +
        `Add PRAGMA synchronous = NORMAL; to your startup SQL or remove any override in your environment.`,
  })

  // ── WAL checkpoint auto ──────────────────────────────────────────────────
  // wal_autocheckpoint = 0 disables automatic checkpointing which can cause
  // the WAL file to grow unboundedly.
  const walAutocheckpoint = pragmaInt(db, 'wal_autocheckpoint')
  const autoCheckpointOk = walAutocheckpoint === null || walAutocheckpoint !== 0
  checks.push({
    pragma: 'wal_autocheckpoint',
    expected: '>0 (default 1000)',
    actual: walAutocheckpoint,
    ok: autoCheckpointOk,
    actionable: autoCheckpointOk
      ? ''
      : `wal_autocheckpoint is 0 — automatic WAL checkpointing is disabled. ` +
        `The WAL file will grow without bound. ` +
        `Remove the PRAGMA wal_autocheckpoint = 0 override or set it to 1000 (the default).`,
  })

  const allOk = checks.every((c) => c.ok)
  return { allOk, checks, dbPath }
}

/**
 * Logs the validation report. Warnings for non-critical issues, errors for
 * anything that could cause data loss or correctness problems.
 */
export function logSqliteValidationReport(report: SqliteValidationReport): void {
  if (report.allOk) {
    logger.info('[DB] SQLite pragma validation passed', {
      dbPath: report.dbPath,
      checks: report.checks.map((c) => ({ pragma: c.pragma, actual: c.actual })),
    })
    return
  }

  const failures = report.checks.filter((c) => !c.ok)

  // foreign_keys and synchronous=OFF are data-integrity risks → error level
  const criticalPragmas = new Set(['foreign_keys', 'synchronous'])
  const hasCritical = failures.some((c) => criticalPragmas.has(c.pragma))

  for (const check of failures) {
    const level = criticalPragmas.has(check.pragma) ? 'error' : 'warn'
    logger[level](`[DB] SQLite pragma issue: ${check.pragma}`, {
      pragma: check.pragma,
      expected: check.expected,
      actual: check.actual,
      fix: check.actionable,
      dbPath: report.dbPath,
    })
  }

  if (hasCritical) {
    logger.error(
      '[DB] One or more critical SQLite pragma checks failed. ' +
        'Data integrity may be at risk. See above for actionable fixes.',
      { dbPath: report.dbPath },
    )
  } else {
    logger.warn(
      '[DB] SQLite pragma warnings detected on startup. ' +
        'Performance or WAL behaviour may be degraded. See above for actionable fixes.',
      { dbPath: report.dbPath },
    )
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pragmaStr(db: Database.Database, name: string): string | null {
  try {
    const row = db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined
    if (!row) return null
    const val = Object.values(row)[0]
    return typeof val === 'string' ? val : val != null ? String(val) : null
  } catch {
    return null
  }
}

function pragmaInt(db: Database.Database, name: string): number | null {
  try {
    const row = db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined
    if (!row) return null
    const val = Object.values(row)[0]
    const n = Number(val)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}
