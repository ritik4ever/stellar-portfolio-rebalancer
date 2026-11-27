import { describe, expect, it } from 'vitest'
import {
    formatUsd,
    formatPercent,
    formatShortDate,
    formatTime,
    parseLocalizedAmount,
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

// ---------------------------------------------------------------------------
// parseLocalizedAmount — SPR-2026-100
// ---------------------------------------------------------------------------

describe('parseLocalizedAmount', () => {
    // -----------------------------------------------------------------------
    // en-US baseline (dot decimal / comma group)
    // -----------------------------------------------------------------------
    it('parses a plain integer string in en-US', () => {
        expect(parseLocalizedAmount('42', 'en-US')).toBe(42)
    })

    it('parses a decimal dot value in en-US', () => {
        expect(parseLocalizedAmount('1234.56789012', 'en-US')).toBeCloseTo(1234.56789012, 10)
    })

    it('strips en-US grouping separators before parsing', () => {
        expect(parseLocalizedAmount('1,234,567.89', 'en-US')).toBeCloseTo(1234567.89, 6)
    })

    // -----------------------------------------------------------------------
    // High-precision Stellar token amounts (7 decimal places — stroops)
    // -----------------------------------------------------------------------
    it('parses a 7-decimal Stellar amount in en-US without precision loss', () => {
        // 0.0000001 XLM = 1 stroop — the minimum Stellar unit
        const result = parseLocalizedAmount('0.0000001', 'en-US')
        expect(result).toBeCloseTo(0.0000001, 7)
        expect(result).toBeGreaterThan(0)
    })

    it('parses a large high-precision token amount in en-US', () => {
        // 9,999,999.9999999 — near upper bound for a Stellar asset
        const result = parseLocalizedAmount('9,999,999.9999999', 'en-US')
        expect(result).toBeCloseTo(9999999.9999999, 6)
    })

    it('parses maximum-precision Stellar amount: 100,000,000.0000000', () => {
        const result = parseLocalizedAmount('100,000,000.0000000', 'en-US')
        expect(result).toBeCloseTo(100000000, 0)
    })

    // -----------------------------------------------------------------------
    // Decimal-comma locale: de-DE  (dot group, comma decimal)
    // -----------------------------------------------------------------------
    it('parses a de-DE decimal-comma amount correctly', () => {
        // "1.234,56" in de-DE = 1234.56 in canonical units
        const result = parseLocalizedAmount('1.234,56', 'de-DE')
        expect(result).toBeCloseTo(1234.56, 2)
    })

    it('parses de-DE high-precision token amount with comma decimal', () => {
        // "0,0000001" = 0.0000001 (1 stroop) in de-DE
        const result = parseLocalizedAmount('0,0000001', 'de-DE')
        expect(result).toBeCloseTo(0.0000001, 7)
    })

    it('parses de-DE large high-precision token amount', () => {
        // "9.999.999,9999999" in de-DE = 9999999.9999999
        const result = parseLocalizedAmount('9.999.999,9999999', 'de-DE')
        expect(result).toBeCloseTo(9999999.9999999, 6)
    })

    // -----------------------------------------------------------------------
    // Decimal-comma locale: fr-FR  (narrow-space group, comma decimal)
    // -----------------------------------------------------------------------
    it('parses a fr-FR decimal-comma amount correctly', () => {
        // "1\u202f234,56" in fr-FR (NARROW NO-BREAK SPACE as group sep)
        const frFormatted = new Intl.NumberFormat('fr-FR').format(1234.56)
        const result = parseLocalizedAmount(frFormatted, 'fr-FR')
        expect(result).toBeCloseTo(1234.56, 2)
    })

    it('parses fr-FR stroop-level precision token amount', () => {
        const frFormatted = new Intl.NumberFormat('fr-FR', {
            maximumFractionDigits: 7,
        }).format(0.0000001)
        const result = parseLocalizedAmount(frFormatted, 'fr-FR')
        expect(result).toBeCloseTo(0.0000001, 7)
    })

    // -----------------------------------------------------------------------
    // pt-BR locale  (dot group, comma decimal)
    // -----------------------------------------------------------------------
    it('parses a pt-BR decimal-comma amount correctly', () => {
        const result = parseLocalizedAmount('1.000,25', 'pt-BR')
        expect(result).toBeCloseTo(1000.25, 2)
    })

    // -----------------------------------------------------------------------
    // Error / edge states
    // -----------------------------------------------------------------------
    it('returns NaN for an empty string', () => {
        expect(parseLocalizedAmount('', 'en-US')).toBeNaN()
    })

    it('returns NaN for a whitespace-only string', () => {
        expect(parseLocalizedAmount('   ', 'en-US')).toBeNaN()
    })

    it('returns NaN for a pure alphabetic string', () => {
        expect(parseLocalizedAmount('abc', 'en-US')).toBeNaN()
    })

    it('returns NaN for a string containing currency symbols', () => {
        expect(parseLocalizedAmount('$1,234.56', 'en-US')).toBeNaN()
    })

    it('silently re-interprets de-DE number when en-US locale is used', () => {
        // "1.234,56" treated as en-US: dot is the decimal separator, comma is
        // the group separator and is stripped.  Result is 1.23456 — not a
        // locale-parse error but a silent mis-interpretation.
        // Callers MUST pass the correct locale to avoid this.
        const result = parseLocalizedAmount('1.234,56', 'en-US')
        // After stripping comma (group sep in en-US) → "1.234.56" → NaN because
        // two dots remain. Actual result depends on whether ',' maps to group sep.
        // jsdom's ICU data: en-US group sep = ',', decimal = '.' 
        // Strip ',': "1.23456" → parseFloat → 1.23456  (silent re-interpretation)
        expect(typeof result === 'number' && !Number.isNaN(result)).toBe(true)
        // The important invariant: calling with the CORRECT locale de-DE parses correctly.
        expect(parseLocalizedAmount('1.234,56', 'de-DE')).toBeCloseTo(1234.56, 2)
    })

    it('returns NaN for a string with two decimal separators', () => {
        expect(parseLocalizedAmount('1.2.3', 'en-US')).toBeNaN()
    })

    it('handles a bare zero string', () => {
        expect(parseLocalizedAmount('0', 'en-US')).toBe(0)
    })

    it('handles a negative token amount', () => {
        expect(parseLocalizedAmount('-0.0000001', 'en-US')).toBeCloseTo(-0.0000001, 7)
    })
})