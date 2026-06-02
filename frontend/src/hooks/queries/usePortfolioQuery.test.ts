import { describe, expect, it } from 'vitest'
import { buildRebalanceConfirmationSummary } from './usePortfolioQuery'

describe('buildRebalanceConfirmationSummary', () => {
    it('includes slippage tolerance when configured', () => {
        const summary = buildRebalanceConfirmationSummary({
            slippageTolerancePercent: 2,
            hasPartialPriceData: false,
            partialPriceMessage: null,
            estimate: { tradeCount: 1, gasEstimateXlm: 0.1, gasEstimateUsd: 0.02 },
            hasHighGasWarning: false,
        })
        expect(summary.slippage.some((line) => line.includes('2%'))).toBe(true)
        expect(summary.risks.some((line) => line.includes('network cost'))).toBe(true)
    })

    it('warns about stale or degraded prices', () => {
        const summary = buildRebalanceConfirmationSummary({
            feedMeta: {
                provider: 'backend',
                resolvedAtMs: Date.now(),
                degraded: false,
                staleOrLimited: true,
                resolutionHint: 'cached_only',
                assetsCount: 2,
            },
            hasPartialPriceData: false,
            partialPriceMessage: null,
            estimate: null,
            hasHighGasWarning: false,
        })
        expect(summary.prices.some((line) => line.toLowerCase().includes('stale'))).toBe(true)
    })
})
