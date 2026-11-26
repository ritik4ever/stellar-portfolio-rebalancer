import { describe, expect, it } from 'vitest'
import { evaluatePriceQuoteBoundary } from '../services/priceQuoteBoundary.js'
import type { PriceFeedMeta, PricesFeedPayload } from '../types/index.js'

const feedMeta: PriceFeedMeta = {
    provider: 'backend',
    resolvedAtMs: 1_700_000_000_000,
    degraded: false,
    staleOrLimited: false,
    resolutionHint: 'partial_merge',
    assetsCount: 2,
}

function payload(entries: Array<[string, { price: number; source?: any; dataTier?: any; servedFromCache?: boolean }]>): PricesFeedPayload {
    return {
        prices: Object.fromEntries(entries.map(([asset, data]) => [asset, {
            price: data.price,
            change: 0,
            timestamp: 1_700_000_000,
            ...data,
        }])),
        feedMeta,
    }
}

describe('price quote boundary (SPR-2026-106)', () => {
    it('accepts a complete Reflector quote set', () => {
        const input = payload([
            ['XLM', { price: 0.354, source: 'reflector', dataTier: 'primary' }],
            ['BTC', { price: 105000, source: 'reflector', dataTier: 'primary' }],
        ])

        const decision = evaluatePriceQuoteBoundary(input)

        expect(decision).toMatchObject({
            result: 'accepted',
            reasonCode: 'FULL_REFLECTOR_COVERAGE',
            provenance: {
                BTC: { source: 'reflector', price: 105000, servedFromCache: false },
                XLM: { source: 'reflector', price: 0.354, servedFromCache: false },
            },
        })
        expect(decision.rejection).toBeUndefined()
        expect(decision.quoteSnapshot.prices).toBe(input.prices)
        expect(decision.quoteSnapshot.feedMeta).toBe(feedMeta)
    })

    it('documents provenance and rejection reason for one missing Reflector quote served by fallback', () => {
        const input = payload([
            ['XLM', { price: 0.354, source: 'reflector', dataTier: 'primary' }],
            ['BTC', { price: 106000, source: 'coingecko_free', dataTier: 'primary', servedFromCache: true }],
        ])

        const decision = evaluatePriceQuoteBoundary(input)

        expect(decision.result).toBe('partial')
        expect(decision.reasonCode).toBe('MISSING_REFLECTOR_QUOTE_FALLBACK')
        expect(decision.rejection).toEqual({
            asset: 'BTC',
            reason: 'MISSING_REFLECTOR_QUOTE',
            acceptedSource: 'coingecko_free',
        })
        expect(decision.provenance.BTC).toEqual({
            source: 'coingecko_free',
            dataTier: 'primary',
            price: 106000,
            servedFromCache: true,
        })
        expect(Object.keys(decision.provenance)).toEqual(['BTC', 'XLM'])
    })

    it('explicitly rejects one missing Reflector quote with no accepted fallback', () => {
        const input = payload([
            ['XLM', { price: 0.354, source: 'reflector', dataTier: 'primary' }],
            ['BTC', { price: 106000, source: 'fallback', dataTier: 'synthetic_fallback' }],
        ])

        const decision = evaluatePriceQuoteBoundary(input)

        expect(decision.result).toBe('rejected')
        expect(decision.reasonCode).toBe('MISSING_REFLECTOR_QUOTE_REJECTED')
        expect(decision.rejection).toEqual({
            asset: 'BTC',
            reason: 'MISSING_REFLECTOR_QUOTE',
            acceptedSource: undefined,
        })
        expect(decision.reason).toContain('BTC')
    })

    it('reports no prices as a stable rejection', () => {
        const input = payload([])

        const decision = evaluatePriceQuoteBoundary(input)

        expect(decision.result).toBe('rejected')
        expect(decision.reasonCode).toBe('NO_PRICES')
        expect(decision.rejection?.reason).toBe('NO_PRICES')
        expect(evaluatePriceQuoteBoundary(input)).toEqual(decision)
    })
})
