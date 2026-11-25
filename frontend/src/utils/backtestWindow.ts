/**
 * Date-window rules for the Historical simulator. These mirror the backend
 * contract in docs/BACKTEST.md. All dates are UTC calendar days (YYYY-MM-DD)
 * and both ends of a window are inclusive.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export const SIMULATOR_MIN_DAYS = 7

/**
 * The API accepts `days` up to 365, but it looks back at most 365 days from
 * now and drops the still-open UTC day, which leaves 364 complete daily closes.
 */
export const SIMULATOR_MAX_DAYS = 364

export type SimulatorField = 'start' | 'end'

export interface SimulatorRangeValidation {
    valid: boolean
    days: number | null
    leapDays: string[]
    field: SimulatorField | null
    error: string | null
}

export function toUtcDateString(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10)
}

/** Parses a strict YYYY-MM-DD date, rejecting impossible days such as 2027-02-29. */
export function parseUtcDate(value: string): number | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
    const ms = Date.parse(`${value}T00:00:00.000Z`)
    if (!Number.isFinite(ms) || toUtcDateString(ms) !== value) return null
    return ms
}

export function getAllowedSimulatorDates(now: number): { earliest: string; latest: string } {
    const today = Math.floor(now / DAY_MS) * DAY_MS
    return {
        earliest: toUtcDateString(today - SIMULATOR_MAX_DAYS * DAY_MS),
        latest: toUtcDateString(today - DAY_MS),
    }
}

/** Returns the range of `days` complete UTC days ending at the latest closed day. */
export function getPresetRange(days: number, now: number): { start: string; end: string } {
    const { latest } = getAllowedSimulatorDates(now)
    const endMs = parseUtcDate(latest) as number
    return { start: toUtcDateString(endMs - (days - 1) * DAY_MS), end: latest }
}

export function countInclusiveDays(startMs: number, endMs: number): number {
    return Math.round((endMs - startMs) / DAY_MS) + 1
}

export function findLeapDays(startMs: number, endMs: number): string[] {
    const leapDays: string[] = []
    const startYear = new Date(startMs).getUTCFullYear()
    const endYear = new Date(endMs).getUTCFullYear()
    for (let year = startYear; year <= endYear; year += 1) {
        const leapDay = `${String(year).padStart(4, '0')}-02-29`
        const leapMs = parseUtcDate(leapDay)
        if (leapMs !== null && leapMs >= startMs && leapMs <= endMs) leapDays.push(leapDay)
    }
    return leapDays
}

export function validateSimulatorRange(
    start: string,
    end: string,
    now: number,
): SimulatorRangeValidation {
    const invalid = (field: SimulatorField, error: string, days: number | null = null, leapDays: string[] = []) => ({
        valid: false,
        days,
        leapDays,
        field,
        error,
    })

    const startMs = parseUtcDate(start)
    if (startMs === null) return invalid('start', 'Enter a valid start date.')
    const endMs = parseUtcDate(end)
    if (endMs === null) return invalid('end', 'Enter a valid end date.')
    if (startMs > endMs) return invalid('start', 'Start date must be on or before the end date.')

    const days = countInclusiveDays(startMs, endMs)
    const leapDays = findLeapDays(startMs, endMs)
    const { earliest, latest } = getAllowedSimulatorDates(now)

    if (end > latest) {
        return invalid('end', `End date must be ${latest} or earlier because the current UTC day has not closed.`, days, leapDays)
    }
    if (start < earliest) {
        return invalid('start', `Start date must be ${earliest} or later. Real price history covers the last ${SIMULATOR_MAX_DAYS} closed days.`, days, leapDays)
    }
    if (days < SIMULATOR_MIN_DAYS) {
        return invalid('start', `Choose at least ${SIMULATOR_MIN_DAYS} days. This range has ${days}.`, days, leapDays)
    }

    return { valid: true, days, leapDays, field: null, error: null }
}

export function toBacktestWindow(start: string, end: string, days: number) {
    return {
        days,
        from: `${start}T00:00:00.000Z`,
        to: `${end}T23:59:59.999Z`,
    }
}
