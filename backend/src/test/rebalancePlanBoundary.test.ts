import { describe, expect, it } from 'vitest'
import { buildRebalancePlan } from '../services/rebalancePlan.js'
import { evaluateRebalancePlanBoundary } from '../services/rebalanceBoundary.js'
import type { Portfolio, PriceFeedMeta, PricesMap } from '../types/index.js'

const prices: PricesMap = {
    USDC: { price: 1, change: 0, timestamp: 1_700_000_000 },
    XLM: { price: 0.35, change: 0, timestamp: 1_700_000_000 },
}

const feedMeta: PriceFeedMeta = {
    provider: 'backend',
    resolvedAtMs: 1_700_000_000_000,
    degraded: false,
    staleOrLimited: false,
    resolutionHint: 'fresh_primary',
    assetsCount: 2,
}

function portfolio(allocations: Record<string, number>, balances: Record<string, number>, threshold = 5): Portfolio {
    return {
        id: 'p-boundary',
        userAddress: 'GABC',
        allocations,
        threshold,
        balances,
        totalValue: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        lastRebalance: '2026-01-01T00:00:00.000Z',
        version: 1,
    }
}

describe('rebalance plan boundary (SPR-2026-116)', () => {
    it('documents a portfolio already inside every threshold with a stable result', () => {
        const input = portfolio({ XLM: 50, USDC: 50 }, { XLM: 1000, USDC: 350 })

        const first = buildRebalancePlan(input, prices, feedMeta)
        const second = buildRebalancePlan(input, prices, feedMeta)

        expect(first.boundary).toEqual({
            result: 'no_trades_needed',
            reasonCode: 'WITHIN_EVERY_THRESHOLD',
            reason: 'Every asset is within the configured drift threshold and the trade list is empty',
            withinEveryThreshold: true,
            thresholdPercent: 5,
            maxDriftPercent: 0,
            trades: [],
            quoteSnapshot: { prices, feedMeta },
        })
        expect(first.boundary).toEqual(second.boundary)
        expect(first.boundary.quoteSnapshot.prices).toBe(prices)
        expect(first.boundary.quoteSnapshot.feedMeta).toBe(feedMeta)
        expect(first.estimatedFees.tradeCount).toBe(0)
    })

    it('lists deterministic trades from the captured quote snapshot', () => {
        const input = portfolio({ XLM: 60, USDC: 40 }, { XLM: 1000, USDC: 100 })

        const plan = buildRebalancePlan(input, prices, feedMeta)

        expect(plan.boundary.result).toBe('trades_required')
        expect(plan.boundary.reasonCode).toBe('TRADES_REQUIRED')
        expect(plan.boundary.trades.map((trade) => trade.asset)).toEqual(['USDC', 'XLM'])
        expect(plan.boundary.trades.map((trade) => trade.action)).toEqual(['buy', 'sell'])
        expect(plan.boundary.trades.every((trade) => trade.amount > 0 && trade.value > 0)).toBe(true)
        expect(plan.boundary.quoteSnapshot).toEqual({ prices, feedMeta })
        expect(buildRebalancePlan(input, prices, feedMeta).boundary).toEqual(plan.boundary)
    })

    it('reports drift above a zero threshold when the minimum trade value suppresses trades', () => {
        const tinyPrices: PricesMap = {
            XLM: { price: 1, change: 0, timestamp: 1_700_000_000 },
            USDC: { price: 1, change: 0, timestamp: 1_700_000_000 },
        }
        const input = portfolio(
            { XLM: 50, USDC: 50 },
            { XLM: 5000.01, USDC: 4999.99 },
            0
        )

        const plan = buildRebalancePlan(input, tinyPrices, feedMeta)

        expect(plan.assets.every((asset) => asset.action === 'hold')).toBe(true)
        expect(plan.boundary.result).toBe('trades_required')
        expect(plan.boundary.reasonCode).toBe('DRIFT_EXCEEDS_THRESHOLD')
        expect(plan.boundary.trades).toEqual([])
        expect(plan.boundary.maxDriftPercent).toBeGreaterThan(0)
        expect(plan.boundary.thresholdPercent).toBe(0)
    })

    it('documents the decision when called directly with a plan', () => {
        const input = portfolio({ XLM: 50, USDC: 50 }, { XLM: 1000, USDC: 350 })
        const plan = buildRebalancePlan(input, prices, feedMeta)
        const { boundary, ...withoutBoundary } = plan

        expect(evaluateRebalancePlanBoundary(withoutBoundary, 5)).toEqual(boundary)
    })
})
