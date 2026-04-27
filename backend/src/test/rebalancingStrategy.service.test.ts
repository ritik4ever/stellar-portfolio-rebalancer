import { describe, expect, it } from 'vitest'
import { shouldRebalanceByStrategy, REBALANCE_STRATEGIES } from '../services/rebalancingStrategyService.js'
import type { Portfolio, PricesMap } from '../types/index.js'

const basePortfolio = (overrides: Partial<Portfolio> = {}): Portfolio => ({
    id: 'p-1',
    userAddress: 'GTEST',
    allocations: { BTC: 50, ETH: 50 },
    threshold: 5,
    balances: { BTC: 1, ETH: 1 },
    totalValue: 200,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastRebalance: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...overrides
})

const stablePrices: PricesMap = {
    BTC: { price: 100, change: 1, timestamp: 1, source: 'external' },
    ETH: { price: 100, change: 1, timestamp: 1, source: 'external' }
}

describe('rebalancingStrategyService', () => {
    it('covers all exported strategy types', () => {
        const strategyTypes = REBALANCE_STRATEGIES.map(s => s.value).sort()
        expect(strategyTypes).toEqual(['custom', 'periodic', 'threshold', 'volatility'])
    })

    it('triggers threshold strategy when drift exceeds configured threshold', () => {
        const portfolio = basePortfolio({
            strategy: 'threshold',
            threshold: 5,
            balances: { BTC: 1.8, ETH: 0.2 }
        })

        const shouldRebalance = shouldRebalanceByStrategy({ portfolio, prices: stablePrices })
        expect(shouldRebalance).toBe(true)
    })

    it('enforces periodic strategy interval and triggers after interval', () => {
        const lastRebalanceMs = new Date('2026-01-01T00:00:00.000Z').getTime()
        const intervalMs = 7 * 24 * 60 * 60 * 1000
        const dueAt = lastRebalanceMs + intervalMs
        const portfolio = basePortfolio({
            strategy: 'periodic',
            strategyConfig: { intervalDays: 7 },
            lastRebalance: '2026-01-01T00:00:00.000Z'
        })

        expect(shouldRebalanceByStrategy({ portfolio, prices: stablePrices, now: dueAt - 1 })).toBe(false)
        expect(shouldRebalanceByStrategy({ portfolio, prices: stablePrices, now: dueAt })).toBe(true)
    })

    it('uses safe threshold fallback for unknown strategy type', () => {
        const portfolio = basePortfolio({
            strategy: 'unknown' as any,
            threshold: 6,
            balances: { BTC: 1.9, ETH: 0.1 }
        })

        const fallbackDecision = shouldRebalanceByStrategy({ portfolio, prices: stablePrices })
        expect(fallbackDecision).toBe(true)
    })

    it('retains strategy config across service restarts without discarding fields', async () => {
        const persisted = basePortfolio({
            strategy: 'custom',
            strategyConfig: {
                type: 'custom',
                minDaysBetweenRebalance: 3,
                intervalDays: 10,
                volatilityThresholdPct: 12,
                enabled: true,
                parameters: { preserve: true }
            },
            lastRebalance: '2026-01-07T00:00:00.000Z',
            balances: { BTC: 1.4, ETH: 0.6 }
        })

        const beforeRestart = shouldRebalanceByStrategy({
            portfolio: persisted,
            prices: stablePrices,
            now: new Date('2026-01-08T00:00:00.000Z').getTime()
        })

        const reloaded = JSON.parse(JSON.stringify(persisted)) as Portfolio
        const serviceReloaded = await import('../services/rebalancingStrategyService.js')
        const afterRestart = serviceReloaded.shouldRebalanceByStrategy({
            portfolio: reloaded,
            prices: stablePrices,
            now: new Date('2026-01-08T00:00:00.000Z').getTime()
        })

        expect(reloaded.strategyConfig).toEqual(persisted.strategyConfig)
        expect(beforeRestart).toBe(afterRestart)
        expect(afterRestart).toBe(false)
    })
})
