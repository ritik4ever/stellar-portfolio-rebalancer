import { describe, expect, it } from 'vitest'
import {
    SIMULATOR_MAX_DAYS,
    findLeapDays,
    getAllowedSimulatorDates,
    getPresetRange,
    parseUtcDate,
    toBacktestWindow,
    validateSimulatorRange,
} from './backtestWindow'

const NOW = Date.parse('2028-03-05T12:00:00.000Z')

describe('backtestWindow', () => {
    it('allows exactly seven inclusive days and rejects six', () => {
        expect(validateSimulatorRange('2028-02-27', '2028-03-04', NOW)).toMatchObject({ valid: true, days: 7 })
        expect(validateSimulatorRange('2028-02-28', '2028-03-04', NOW)).toMatchObject({
            valid: false,
            days: 6,
            field: 'start',
            error: 'Choose at least 7 days. This range has 6.',
        })
    })

    it('counts Feb 29 in a leap-year window', () => {
        const result = validateSimulatorRange('2028-02-27', '2028-03-04', NOW)
        expect(result.days).toBe(7)
        expect(result.leapDays).toEqual(['2028-02-29'])
    })

    it('does not report a leap day in a non-leap year', () => {
        expect(findLeapDays(parseUtcDate('2027-02-20')!, parseUtcDate('2027-03-05')!)).toEqual([])
    })

    it('rejects impossible calendar dates', () => {
        expect(parseUtcDate('2027-02-29')).toBeNull()
        expect(parseUtcDate('2028-02-29')).not.toBeNull()
        expect(validateSimulatorRange('2027-02-29', '2027-03-08', NOW).field).toBe('start')
    })

    it('excludes the open UTC day', () => {
        expect(getAllowedSimulatorDates(NOW).latest).toBe('2028-03-04')
        expect(validateSimulatorRange('2028-02-28', '2028-03-05', NOW)).toMatchObject({ valid: false, field: 'end' })
    })

    it('accepts the maximum window and rejects one day earlier', () => {
        const max = getPresetRange(SIMULATOR_MAX_DAYS, NOW)
        expect(max.start).toBe(getAllowedSimulatorDates(NOW).earliest)
        expect(validateSimulatorRange(max.start, max.end, NOW)).toMatchObject({ valid: true, days: 364 })

        const before = new Date(Date.parse(`${max.start}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10)
        expect(validateSimulatorRange(before, max.end, NOW)).toMatchObject({ valid: false, field: 'start' })
    })

    it('rejects a reversed range', () => {
        expect(validateSimulatorRange('2028-03-04', '2028-02-20', NOW)).toMatchObject({ valid: false, field: 'start' })
    })

    it('sends a full UTC-day window', () => {
        expect(toBacktestWindow('2028-02-27', '2028-03-04', 7)).toEqual({
            days: 7,
            from: '2028-02-27T00:00:00.000Z',
            to: '2028-03-04T23:59:59.999Z',
        })
    })
})
