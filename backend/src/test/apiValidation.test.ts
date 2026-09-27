import { describe, expect, it } from 'vitest'
import {
    analyticsBenchmarkQuerySchema,
    analyticsQuerySchema,
} from '../api/validation.js'

describe('analyticsQuerySchema (issue #1430)', () => {
    it('accepts a valid days-only query and normalizes days', () => {
        const result = analyticsQuerySchema.safeParse({ days: '30' })

        expect(result.success).toBe(true)
        if (result.success) expect(result.data.days).toBe(30)
    })

    it('accepts a valid from/to range', () => {
        expect(analyticsQuerySchema.safeParse({
            from: '2025-01-01T00:00:00Z',
            to: '2025-01-31T00:00:00Z',
        }).success).toBe(true)
    })

    it.each([
        [{ days: '0' }, 'out-of-range days'],
        [{ from: '2025-01-01T00:00:00Z' }, 'unpaired date'],
        [{ from: 'not-a-date', to: '2025-01-02T00:00:00Z' }, 'invalid date'],
        [{ from: '2025-02-01T00:00:00Z', to: '2025-01-01T00:00:00Z' }, 'reversed date range'],
        [{ unexpected: 'value' }, 'unknown query field'],
    ])('rejects %s', (query) => {
        expect(analyticsQuerySchema.safeParse(query).success).toBe(false)
    })

    it('rejects future dates', () => {
        const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        expect(analyticsQuerySchema.safeParse({ from: future, to: future }).success).toBe(false)
    })
})

describe('analyticsBenchmarkQuerySchema (issue #1430)', () => {
    it('requires both from and to', () => {
        expect(analyticsBenchmarkQuerySchema.safeParse({}).success).toBe(false)
        expect(analyticsBenchmarkQuerySchema.safeParse({ from: '2025-01-01T00:00:00Z' }).success).toBe(false)
        expect(analyticsBenchmarkQuerySchema.safeParse({ to: '2025-01-31T00:00:00Z' }).success).toBe(false)
    })

    it('accepts a valid range', () => {
        expect(analyticsBenchmarkQuerySchema.safeParse({
            from: '2025-01-01T00:00:00Z',
            to: '2025-01-31T00:00:00Z',
        }).success).toBe(true)
    })

    it.each([
        [{ from: 'garbage', to: '2025-01-31T00:00:00Z' }, 'invalid date'],
        [{ from: '2025-02-01T00:00:00Z', to: '2025-01-01T00:00:00Z' }, 'reversed date range'],
    ])('rejects %s', (query) => {
        expect(analyticsBenchmarkQuerySchema.safeParse(query).success).toBe(false)
    })

    it('rejects future dates', () => {
        const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        expect(analyticsBenchmarkQuerySchema.safeParse({ from: future, to: future }).success).toBe(false)
    })
})
