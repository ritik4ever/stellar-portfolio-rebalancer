import { describe, expect, it } from 'vitest'
import { formatUsd, formatPercent } from './localeFormat'

describe('localeFormat', () => {
    it('formats USD values for display', () => {
        expect(formatUsd(1234.56)).toContain('1,234')
    })

    it('formats signed percentages', () => {
        expect(formatPercent(1.5)).toBe('+1.50%')
        expect(formatPercent(-2)).toBe('-2.00%')
    })
})
