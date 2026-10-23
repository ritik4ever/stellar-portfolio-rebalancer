import { query } from './client.js'
import type {
    BacktestRecord,
    BacktestMetricsSummary,
    BacktestStatus,
    BacktestWindowDecision,
    BacktestRebalanceEvent,
    AbsentDayDetail,
} from '../services/backtest.js'

export interface BacktestRecordRow {
    id: string
    portfolio_id: string | null
    allocations: unknown
    threshold: string | number
    initial_value: string | number
    days: number
    from_date: Date | null
    to_date: Date | null
    start_date: string | null
    end_date: string | null
    start_timestamp: string | number | null
    end_timestamp: string | number | null
    status: string
    has_leap_day: boolean
    leap_day_included: boolean
    included_days: unknown
    absent_day_reasons: unknown
    absent_days: unknown
    decision: unknown
    events: unknown
    result: unknown
    error: string | null
    created_at: Date
    updated_at: Date
}

function parseJsonField<T>(val: unknown, fallback: T): T {
    if (val == null) return fallback
    if (typeof val === 'string') {
        try {
            return JSON.parse(val) as T
        } catch {
            return fallback
        }
    }
    return val as T
}

function rowToRecord(r: BacktestRecordRow): BacktestRecord {
    return {
        id: r.id,
        portfolioId: r.portfolio_id ?? undefined,
        allocations: parseJsonField<Record<string, number>>(r.allocations, {}),
        threshold: Number(r.threshold),
        initialValue: Number(r.initial_value),
        days: r.days,
        from: r.from_date ? r.from_date.toISOString() : undefined,
        to: r.to_date ? r.to_date.toISOString() : undefined,
        startDate: r.start_date ?? undefined,
        endDate: r.end_date ?? undefined,
        startTimestamp: r.start_timestamp != null ? Number(r.start_timestamp) : undefined,
        endTimestamp: r.end_timestamp != null ? Number(r.end_timestamp) : undefined,
        status: r.status as BacktestStatus,
        hasLeapDay: Boolean(r.has_leap_day),
        leapDayIncluded: Boolean(r.leap_day_included),
        includedDays: parseJsonField<string[]>(r.included_days, []),
        absentDayReasons: parseJsonField<Record<string, string>>(r.absent_day_reasons, {}),
        absentDays: parseJsonField<AbsentDayDetail[]>(r.absent_days, []),
        decision: parseJsonField<BacktestWindowDecision | undefined>(r.decision, undefined),
        events: parseJsonField<BacktestRebalanceEvent[] | undefined>(r.events, undefined),
        result: parseJsonField<BacktestMetricsSummary | undefined>(r.result, undefined),
        error: r.error ?? undefined,
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
    }
}

export async function dbInsertBacktestRecord(record: BacktestRecord): Promise<void> {
    await query(
        `INSERT INTO backtest_records (
            id, portfolio_id, allocations, threshold, initial_value, days,
            from_date, to_date, start_date, end_date, start_timestamp, end_timestamp,
            status, has_leap_day, leap_day_included, included_days, absent_day_reasons,
            absent_days, decision, events, result, error, created_at, updated_at
        ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11, $12,
            $13, $14, $15, $16, $17,
            $18, $19, $20, $21, $22, COALESCE($23, NOW()), COALESCE($24, NOW())
        )`,
        [
            record.id,
            record.portfolioId ?? null,
            JSON.stringify(record.allocations ?? {}),
            record.threshold,
            record.initialValue,
            record.days,
            record.from ? new Date(record.from) : null,
            record.to ? new Date(record.to) : null,
            record.startDate ?? null,
            record.endDate ?? null,
            record.startTimestamp ?? null,
            record.endTimestamp ?? null,
            record.status,
            record.hasLeapDay ?? false,
            record.leapDayIncluded ?? false,
            JSON.stringify(record.includedDays ?? []),
            JSON.stringify(record.absentDayReasons ?? {}),
            JSON.stringify(record.absentDays ?? []),
            record.decision ? JSON.stringify(record.decision) : null,
            record.events ? JSON.stringify(record.events) : '[]',
            record.result ? JSON.stringify(record.result) : null,
            record.error ?? null,
            record.createdAt ? new Date(record.createdAt) : null,
            record.updatedAt ? new Date(record.updatedAt) : null,
        ]
    )
}

export async function dbUpdateBacktestRecord(id: string, updates: Partial<BacktestRecord>): Promise<void> {
    const fields: string[] = []
    const values: unknown[] = [id]
    let idx = 2

    if (updates.status !== undefined) {
        fields.push(`status = $${idx++}`)
        values.push(updates.status)
    }
    if (updates.startDate !== undefined) {
        fields.push(`start_date = $${idx++}`)
        values.push(updates.startDate)
    }
    if (updates.endDate !== undefined) {
        fields.push(`end_date = $${idx++}`)
        values.push(updates.endDate)
    }
    if (updates.startTimestamp !== undefined) {
        fields.push(`start_timestamp = $${idx++}`)
        values.push(updates.startTimestamp)
    }
    if (updates.endTimestamp !== undefined) {
        fields.push(`end_timestamp = $${idx++}`)
        values.push(updates.endTimestamp)
    }
    if (updates.hasLeapDay !== undefined) {
        fields.push(`has_leap_day = $${idx++}`)
        values.push(updates.hasLeapDay)
    }
    if (updates.leapDayIncluded !== undefined) {
        fields.push(`leap_day_included = $${idx++}`)
        values.push(updates.leapDayIncluded)
    }
    if (updates.includedDays !== undefined) {
        fields.push(`included_days = $${idx++}`)
        values.push(JSON.stringify(updates.includedDays))
    }
    if (updates.absentDayReasons !== undefined) {
        fields.push(`absent_day_reasons = $${idx++}`)
        values.push(JSON.stringify(updates.absentDayReasons))
    }
    if (updates.absentDays !== undefined) {
        fields.push(`absent_days = $${idx++}`)
        values.push(JSON.stringify(updates.absentDays))
    }
    if (updates.decision !== undefined) {
        fields.push(`decision = $${idx++}`)
        values.push(updates.decision ? JSON.stringify(updates.decision) : null)
    }
    if (updates.events !== undefined) {
        fields.push(`events = $${idx++}`)
        values.push(updates.events ? JSON.stringify(updates.events) : '[]')
    }
    if (updates.result !== undefined) {
        fields.push(`result = $${idx++}`)
        values.push(updates.result ? JSON.stringify(updates.result) : null)
    }
    if (updates.error !== undefined) {
        fields.push(`error = $${idx++}`)
        values.push(updates.error)
    }
    fields.push(`updated_at = NOW()`)

    if (fields.length === 1) return

    await query(
        `UPDATE backtest_records SET ${fields.join(', ')} WHERE id = $1`,
        values
    )
}

export async function dbGetBacktestRecord(id: string): Promise<BacktestRecord | null> {
    const res = await query<BacktestRecordRow>(
        `SELECT * FROM backtest_records WHERE id = $1`,
        [id]
    )
    if (res.rows.length === 0) return null
    return rowToRecord(res.rows[0])
}

export async function dbGetBacktestRecordsByPortfolio(portfolioId: string, limit = 50, offset = 0): Promise<BacktestRecord[]> {
    const res = await query<BacktestRecordRow>(
        `SELECT * FROM backtest_records WHERE portfolio_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [portfolioId, limit, offset]
    )
    return res.rows.map(rowToRecord)
}

export async function dbListBacktestRecords(options?: {
    portfolioId?: string
    status?: string
    limit?: number
    offset?: number
}): Promise<BacktestRecord[]> {
    const conditions: string[] = []
    const values: unknown[] = []
    let idx = 1

    if (options?.portfolioId) {
        conditions.push(`portfolio_id = $${idx++}`)
        values.push(options.portfolioId)
    }
    if (options?.status) {
        conditions.push(`status = $${idx++}`)
        values.push(options.status)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = options?.limit ?? 50
    const offset = options?.offset ?? 0

    values.push(limit)
    values.push(offset)

    const res = await query<BacktestRecordRow>(
        `SELECT * FROM backtest_records ${whereClause} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
        values
    )
    return res.rows.map(rowToRecord)
}
