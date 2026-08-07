import { describe, it, expect } from 'vitest'
import {
    analyticsQuerySchema,
    analyticsBenchmarkQuerySchema,
} from '../api/validation.js'

describe('analyticsQuerySchema (issue #1430)', () => {
    it('accepts a valid days-only query', () => {
        const result = analyticsQuerySchema.safeParse({ days: '30' })
        expect(result.success).toBe(true)
        if (result.success) {
            expect(result.data.days).toBe(30)
            expect(result.data.from).toBeUndefined()
        }
    })

    it('rejects negative days', () => {
        const result = analyticsQuerySchema.safeParse({ days: '-5' })
        expect(result.success).toBe(false)
    })

    it('accepts a valid from/to range', () => {
        const result = analyticsQuerySchema.safeParse({
            from: '2025-01-01T00:00:00Z',
            to: '2025-01-31T00:00:00Z',
        })
        expect(result.success).toBe(true)
    })

    it('rejects from without to', () => {
        const result = analyticsQuerySchema.safeParse({ from: '2025-01-01T00:00:00Z' })
        expect(result.success).toBe(false)
    })

    it('rejects malformed dates', () => {
        const result = analyticsQuerySchema.safeParse({
            from: 'not-a-date',
            to: '2025-01-31T00:00:00Z',
        })
        expect(result.success).toBe(false)
    })

    it('rejects future dates', () => {
        const future = new Date(Date.now() + 48 * 3600 * 1000).toISOString()
        const result = analyticsQuerySchema.safeParse({
            from: future,
            to: future,
        })
        expect(result.success).toBe(false)
    })

    it('rejects from after to', () => {
        const result = analyticsQuerySchema.safeParse({
            from: '2025-02-01T00:00:00Z',
            to: '2025-01-01T00:00:00Z',
        })
        expect(result.success).toBe(false)
    })
})

describe('analyticsBenchmarkQuerySchema (issue #1430)', () => {
    it('accepts valid from/to', () => {
        const result = analyticsBenchmarkQuerySchema.safeParse({
            from: '2025-01-01T00:00:00Z',
            to: '2025-01-31T00:00:00Z',
        })
        expect(result.success).toBe(true)
    })

    it('rejects missing from', () => {
        const result = analyticsBenchmarkQuerySchema.safeParse({ to: '2025-01-31T00:00:00Z' })
        expect(result.success).toBe(false)
    })

    it('rejects missing to', () => {
        const result = analyticsBenchmarkQuerySchema.safeParse({ from: '2025-01-01T00:00:00Z' })
        expect(result.success).toBe(false)
    })

    it('rejects invalid date strings', () => {
        const result = analyticsBenchmarkQuerySchema.safeParse({
            from: 'garbage',
            to: '2025-01-31T00:00:00Z',
        })
        expect(result.success).toBe(false)
    })

    it('rejects future dates', () => {
        const future = new Date(Date.now() + 48 * 3600 * 1000).toISOString()
        const result = analyticsBenchmarkQuerySchema.safeParse({
            from: future,
            to: future,
        })
        expect(result.success).toBe(false)
    })
})