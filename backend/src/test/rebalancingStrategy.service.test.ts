import { describe, expect, it } from 'vitest'
import {
    computeDcaSchedule,
    crossCheckRebalanceDecision,
    shouldRebalanceByStrategy,
    REBALANCE_STRATEGIES,
} from '../services/rebalancingStrategyService.js'
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
        expect(strategyTypes).toEqual(['custom', 'dca', 'periodic', 'threshold', 'volatility'])
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

    describe('DCA strategy schedule computation', () => {
        const DCA_PORTFOLIO = basePortfolio({
            strategy: 'dca',
            strategyConfig: { dcaAmount: 100, dcaIntervalDays: 30 },
            lastRebalance: '2026-01-01T00:00:00.000Z'
        })

        it('computes scheduled buy amount and interval from strategyConfig', () => {
            const schedule = computeDcaSchedule(DCA_PORTFOLIO, DCA_PORTFOLIO.strategyConfig!)
            expect(schedule.intervalDays).toBe(30)
            expect(schedule.intervalMs).toBe(30 * 24 * 60 * 60 * 1000)
            expect(schedule.amount).toBe(100)
            expect(schedule.nextBuyAtMs).toBe(
                new Date('2026-01-01T00:00:00.000Z').getTime() + schedule.intervalMs
            )
        })

        it('falls back to intervalDays and the 7-day default when DCA fields are absent', () => {
            const intervalFallback = computeDcaSchedule(
                basePortfolio({ strategy: 'dca', strategyConfig: { intervalDays: 14 } }),
                { intervalDays: 14 }
            )
            expect(intervalFallback.intervalDays).toBe(14)
            expect(intervalFallback.amount).toBe(0)

            const defaults = computeDcaSchedule(basePortfolio({ strategy: 'dca' }), {})
            expect(defaults.intervalDays).toBe(7)
            expect(defaults.amount).toBe(0)
        })

        it('triggers only after the DCA interval has elapsed', () => {
            const dueAt = new Date('2026-01-01T00:00:00.000Z').getTime() + 30 * 24 * 60 * 60 * 1000
            expect(shouldRebalanceByStrategy({ portfolio: DCA_PORTFOLIO, prices: stablePrices, now: dueAt - 1 })).toBe(false)
            expect(shouldRebalanceByStrategy({ portfolio: DCA_PORTFOLIO, prices: stablePrices, now: dueAt })).toBe(true)
        })

        it('does not trigger when no buy amount is configured', () => {
            const noAmount = basePortfolio({
                strategy: 'dca',
                strategyConfig: { dcaAmount: 0, dcaIntervalDays: 7 },
                lastRebalance: '2026-01-01T00:00:00.000Z'
            })
            const dueAt = new Date('2026-01-01T00:00:00.000Z').getTime() + 8 * 24 * 60 * 60 * 1000
            expect(shouldRebalanceByStrategy({ portfolio: noAmount, prices: stablePrices, now: dueAt })).toBe(false)
        })

        it('is drift-independent – triggers even when allocations are in balance', () => {
            const balanced = basePortfolio({
                strategy: 'dca',
                strategyConfig: { dcaAmount: 100, dcaIntervalDays: 30 },
                balances: { BTC: 100, ETH: 100 },
                lastRebalance: '2026-01-01T00:00:00.000Z'
            })
            const dueAt = new Date('2026-01-01T00:00:00.000Z').getTime() + 30 * 24 * 60 * 60 * 1000
            expect(shouldRebalanceByStrategy({ portfolio: balanced, prices: stablePrices, now: dueAt })).toBe(true)
        })
    })

    describe('crossCheckRebalanceDecision', () => {
        const driftedCtx = () => ({
            portfolio: basePortfolio({
                strategy: 'threshold',
                threshold: 5,
                balances: { BTC: 1.8, ETH: 0.2 }
            }),
            prices: stablePrices
        })

        it('agrees and executes when backend and on-chain decisions match', async () => {
            const result = await crossCheckRebalanceDecision(driftedCtx(), async () => true)
            expect(result.backendDecision).toBe(true)
            expect(result.onChainDecision).toBe(true)
            expect(result.agreement).toBe(true)
            expect(result.finalDecision).toBe(true)
            expect(result.warning).toBeUndefined()
        })

        it('warns but does not block when decisions disagree in warn-only mode', async () => {
            const result = await crossCheckRebalanceDecision(driftedCtx(), async () => false, {
                requireAgreement: false,
                alertOnDisagreement: true
            })
            expect(result.backendDecision).toBe(true)
            expect(result.onChainDecision).toBe(false)
            expect(result.agreement).toBe(false)
            // Backend decision wins during warn-only rollout.
            expect(result.finalDecision).toBe(true)
            expect(result.warning).toBeDefined()
        })

        it('blocks execution on disagreement when requireAgreement is enabled (fail-safe)', async () => {
            const result = await crossCheckRebalanceDecision(driftedCtx(), async () => false, {
                requireAgreement: true,
                alertOnDisagreement: true
            })
            expect(result.agreement).toBe(false)
            expect(result.finalDecision).toBe(false)
        })

        it('falls back to the backend decision when the on-chain check fails', async () => {
            const result = await crossCheckRebalanceDecision(
                driftedCtx(),
                async () => { throw new Error('rpc unavailable') }
            )
            expect(result.backendDecision).toBe(true)
            expect(result.onChainDecision).toBe(true)
            expect(result.agreement).toBe(true)
            expect(result.finalDecision).toBe(true)
            expect(result.warning).toBeDefined()
        })

        it('agrees on no-op when both sides agree that no rebalance is needed', async () => {
            const calmCtx = () => ({
                portfolio: basePortfolio({ strategy: 'threshold', threshold: 5 }),
                prices: stablePrices
            })
            const result = await crossCheckRebalanceDecision(calmCtx(), async () => false)
            expect(result.backendDecision).toBe(false)
            expect(result.onChainDecision).toBe(false)
            expect(result.agreement).toBe(true)
            expect(result.finalDecision).toBe(false)
        })
    })
})
