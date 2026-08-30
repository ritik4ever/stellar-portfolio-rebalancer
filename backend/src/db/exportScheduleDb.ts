/**
 * exportScheduleDb.ts
 * Storage for recurring portfolio export schedules (#1411).
 *
 * One row per portfolio. `next_run_at` is the scheduling cursor: the weekly
 * worker claims every schedule whose cursor is in the past, so a missed run is
 * picked up on the next tick instead of being skipped.
 */

import Database from 'better-sqlite3'

export type ExportScheduleFrequency = 'weekly'
export type ExportScheduleFormat = 'csv'

export interface ExportSchedule {
    portfolioId: string
    userAddress: string
    frequency: ExportScheduleFrequency
    format: ExportScheduleFormat
    emailAddress: string
    enabled: boolean
    nextRunAt: string
    lastRunAt?: string
    lastStatus?: 'success' | 'failed'
    lastError?: string
    createdAt: string
    updatedAt: string
}

interface ExportScheduleRow {
    portfolio_id: string
    user_address: string
    frequency: string
    format: string
    email_address: string
    enabled: number
    next_run_at: string
    last_run_at: string | null
    last_status: string | null
    last_error: string | null
    created_at: string
    updated_at: string
}

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000

let scheduleDb: Database.Database | null = null

function getDb(): Database.Database {
    if (!scheduleDb) {
        const dbPath = process.env.DB_PATH || './data/portfolio.db'
        scheduleDb = new Database(dbPath)
    }
    return scheduleDb
}

export function closeExportScheduleDb(): void {
    if (scheduleDb) {
        scheduleDb.close()
        scheduleDb = null
    }
}

function ensureTable(): void {
    getDb().exec(`
        CREATE TABLE IF NOT EXISTS export_schedules (
            portfolio_id  TEXT PRIMARY KEY,
            user_address  TEXT NOT NULL,
            frequency     TEXT NOT NULL DEFAULT 'weekly',
            format        TEXT NOT NULL DEFAULT 'csv',
            email_address TEXT NOT NULL,
            enabled       INTEGER NOT NULL DEFAULT 1,
            next_run_at   TEXT NOT NULL,
            last_run_at   TEXT,
            last_status   TEXT,
            last_error    TEXT,
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_export_schedules_due
            ON export_schedules(enabled, next_run_at);
        CREATE INDEX IF NOT EXISTS idx_export_schedules_user
            ON export_schedules(user_address);
    `)
}

function rowToSchedule(row: ExportScheduleRow): ExportSchedule {
    return {
        portfolioId: row.portfolio_id,
        userAddress: row.user_address,
        frequency: row.frequency as ExportScheduleFrequency,
        format: row.format as ExportScheduleFormat,
        emailAddress: row.email_address,
        enabled: row.enabled === 1,
        nextRunAt: row.next_run_at,
        lastRunAt: row.last_run_at ?? undefined,
        lastStatus: (row.last_status as 'success' | 'failed' | null) ?? undefined,
        lastError: row.last_error ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }
}

export function dbUpsertExportSchedule(input: {
    portfolioId: string
    userAddress: string
    emailAddress: string
    frequency?: ExportScheduleFrequency
    format?: ExportScheduleFormat
    enabled?: boolean
    nextRunAt?: string
}): ExportSchedule {
    ensureTable()
    const now = new Date().toISOString()
    const nextRunAt = input.nextRunAt ?? new Date(Date.now() + WEEK_MS).toISOString()

    getDb()
        .prepare(
            `INSERT INTO export_schedules
                (portfolio_id, user_address, frequency, format, email_address, enabled,
                 next_run_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (portfolio_id) DO UPDATE SET
                user_address  = excluded.user_address,
                frequency     = excluded.frequency,
                format        = excluded.format,
                email_address = excluded.email_address,
                enabled       = excluded.enabled,
                next_run_at   = excluded.next_run_at,
                updated_at    = excluded.updated_at`,
        )
        .run(
            input.portfolioId,
            input.userAddress,
            input.frequency ?? 'weekly',
            input.format ?? 'csv',
            input.emailAddress,
            input.enabled === false ? 0 : 1,
            nextRunAt,
            now,
            now,
        )

    return dbGetExportSchedule(input.portfolioId)!
}

export function dbGetExportSchedule(portfolioId: string): ExportSchedule | undefined {
    ensureTable()
    const row = getDb()
        .prepare<[string], ExportScheduleRow>(
            'SELECT * FROM export_schedules WHERE portfolio_id = ?',
        )
        .get(portfolioId)
    return row ? rowToSchedule(row) : undefined
}

export function dbListExportSchedulesForUser(userAddress: string): ExportSchedule[] {
    ensureTable()
    const rows = getDb()
        .prepare<[string], ExportScheduleRow>(
            'SELECT * FROM export_schedules WHERE user_address = ? ORDER BY created_at ASC',
        )
        .all(userAddress)
    return rows.map(rowToSchedule)
}

/** Enabled schedules whose next run is due at or before `asOf`. */
export function dbListDueExportSchedules(asOf: string = new Date().toISOString()): ExportSchedule[] {
    ensureTable()
    const rows = getDb()
        .prepare<[string], ExportScheduleRow>(
            `SELECT * FROM export_schedules
             WHERE enabled = 1 AND next_run_at <= ?
             ORDER BY next_run_at ASC`,
        )
        .all(asOf)
    return rows.map(rowToSchedule)
}

/** Record the outcome of a run and move the cursor forward one period. */
export function dbRecordExportScheduleRun(
    portfolioId: string,
    outcome: { status: 'success' | 'failed'; error?: string; nextRunAt?: string },
): void {
    ensureTable()
    const now = new Date().toISOString()
    getDb()
        .prepare(
            `UPDATE export_schedules
             SET last_run_at = ?, last_status = ?, last_error = ?, next_run_at = ?, updated_at = ?
             WHERE portfolio_id = ?`,
        )
        .run(
            now,
            outcome.status,
            outcome.error ?? null,
            outcome.nextRunAt ?? new Date(Date.now() + WEEK_MS).toISOString(),
            now,
            portfolioId,
        )
}

export function dbDeleteExportSchedule(portfolioId: string): boolean {
    ensureTable()
    const result = getDb()
        .prepare('DELETE FROM export_schedules WHERE portfolio_id = ?')
        .run(portfolioId)
    return result.changes > 0
}
