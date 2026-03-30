import { describe, it, expect } from 'vitest'
import { formatPriceFeedSummary, unwrapPriceFeedPayload } from './usePricesQuery'

describe('usePricesQuery helpers', () => {
    it('unwraps wrapped API payload', () => {
        const raw = {
            prices: { XLM: { price: 0.1, timestamp: 1 } },
            feedMeta: {
                provider: 'backend' as const,
                resolvedAtMs: 1,
                degraded: false,
                staleOrLimited: false,
                resolutionHint: 'fresh_primary',
                assetsCount: 1,
            },
        }
        const u = unwrapPriceFeedPayload(raw)
        expect(u.prices.XLM).toEqual({ price: 0.1, timestamp: 1 })
        expect(u.feedMeta?.provider).toBe('backend')
    })

    it('unwraps legacy flat map', () => {
        const u = unwrapPriceFeedPayload({ BTC: { price: 2, timestamp: 2 } })
        expect(u.prices.BTC).toEqual({ price: 2, timestamp: 2 })
        expect(u.feedMeta).toBeUndefined()
    })

    it('formats summary for degraded browser feed', () => {
        const s = formatPriceFeedSummary(
            {
                provider: 'browser',
                resolvedAtMs: 1,
                degraded: true,
                staleOrLimited: false,
                resolutionHint: 'synthetic_fallback',
                assetsCount: 2,
            },
            true,
            false
        )
        expect(s).toContain('Browser synthetic')
    })
})
