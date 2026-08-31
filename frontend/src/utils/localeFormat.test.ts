import { describe, expect, it } from 'vitest'
import {
    formatUsd,
    formatPercent,
    formatShortDate,
    formatTime,
} from './localeFormat'

describe('localeFormat', () => {
    it('formats USD values for display', () => {
        expect(formatUsd(1234.56)).toContain('1,234')
    })

    it('formats signed percentages', () => {
        expect(formatPercent(1.5)).toBe('+1.50%')
        expect(formatPercent(-2)).toBe('-2.00%')
    })

    it('formats zero percentage with a positive sign', () => {
        expect(formatPercent(0)).toBe('+0.00%')
    })

    it('returns placeholder for missing or invalid dates', () => {
        expect(formatShortDate(undefined)).toBe('—')
        expect(formatShortDate(null)).toBe('—')
        expect(formatShortDate('invalid-date')).toBe('—')
    })

    it('returns placeholder for missing or invalid times', () => {
        expect(formatTime(undefined)).toBe('—')
        expect(formatTime(null)).toBe('—')
        expect(formatTime('invalid-date')).toBe('—')
    })
})