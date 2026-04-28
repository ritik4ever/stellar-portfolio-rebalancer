import { describe, it, expect } from 'vitest'
import { calculateRebalanceTrades } from './calculations'

const makePortfolio = (allocations: any[], totalValue = 10000, threshold = 5) => ({
    allocations,
    totalValue,
    threshold,
})

describe('calculateRebalanceTrades', () => {
    it('returns trades when drift exceeds threshold', () => {
        const portfolio = makePortfolio([
            { asset: 'XLM', current: 60, target: 50, amount: 6000 },
        ])
        const trades = calculateRebalanceTrades(portfolio)
        expect(trades).toHaveLength(1)
        expect(trades[0]).toEqual({ asset: 'XLM', action: 'sell', amount: 1000 })
    })

    it('returns no trades when drift is within threshold', () => {
        const portfolio = makePortfolio([
            { asset: 'XLM', current: 52, target: 50, amount: 5200 },
        ])
        const trades = calculateRebalanceTrades(portfolio)
        expect(trades).toHaveLength(0)
    })

    it('returns buy trade when asset is under-allocated', () => {
        const portfolio = makePortfolio([
            { asset: 'BTC', current: 30, target: 50, amount: 3000 },
        ])
        const trades = calculateRebalanceTrades(portfolio)
        expect(trades).toHaveLength(1)
        expect(trades[0].action).toBe('buy')
        expect(trades[0].amount).toBeCloseTo(2000)
    })

    it('returns empty array for empty portfolio', () => {
        const portfolio = makePortfolio([])
        expect(calculateRebalanceTrades(portfolio)).toEqual([])
    })

    it('handles single asset portfolio correctly', () => {
        const portfolio = makePortfolio([
            { asset: 'ETH', current: 100, target: 100, amount: 10000 },
        ])
        expect(calculateRebalanceTrades(portfolio)).toHaveLength(0)
    })

    it('skips trades where difference is <= $10', () => {
        // drift=6 > threshold=5, but targetValue - amount = 5000 - 4995 = 5 <= 10
        const portfolio = makePortfolio([
            { asset: 'XLM', current: 56, target: 50, amount: 4995 },
        ])
        const trades = calculateRebalanceTrades(portfolio)
        expect(trades).toHaveLength(0)
    })

    it('handles multiple assets with mixed drift', () => {
        const portfolio = makePortfolio([
            { asset: 'XLM', current: 60, target: 50, amount: 6000 },  // drift=10, over
            { asset: 'BTC', current: 52, target: 50, amount: 5200 },  // drift=2, under threshold
            { asset: 'ETH', current: 30, target: 50, amount: 3000 },  // drift=20, under
        ])
        const trades = calculateRebalanceTrades(portfolio)
        expect(trades).toHaveLength(2)
        expect(trades.find(t => t.asset === 'XLM')?.action).toBe('sell')
        expect(trades.find(t => t.asset === 'ETH')?.action).toBe('buy')
    })

    it('returns no trades when drift is exactly at target (0%)', () => {
        const portfolio = makePortfolio([
            { asset: 'XLM', current: 50, target: 50, amount: 5000 },
        ])
        const trades = calculateRebalanceTrades(portfolio)
        expect(trades).toHaveLength(0)
    })

    it('returns trades when drift is exactly at threshold boundary', () => {
        // threshold is 5, drift is 5.1 -> should trade
        const portfolio = makePortfolio([
            { asset: 'XLM', current: 55.1, target: 50, amount: 5510 },
        ], 10000, 5)
        const trades = calculateRebalanceTrades(portfolio)
        expect(trades).toHaveLength(1)
        expect(trades[0].amount).toBeCloseTo(510)
    })

    it('handles a 10-asset portfolio without cumulative rounding errors', () => {
        const allocations = Array.from({ length: 10 }, (_, i) => ({
            asset: `ASSET_${i}`,
            current: 10,
            target: 10,
            amount: 1000.00000001 // Tiny rounding noise
        }))
        const portfolio = makePortfolio(allocations, 10000, 1)
        const trades = calculateRebalanceTrades(portfolio)
        expect(trades).toHaveLength(0) // Noise should be ignored by the >$10 check
    })

    it('delta calculation matches hand-computed reference for deep rebalance', () => {
        // Total Value = 20000. XLM Target 50% = 10000. Current Amount 4000. Delta = 6000 BUY.
        const portfolio = makePortfolio([
            { asset: 'XLM', current: 20, target: 50, amount: 4000 },
        ], 20000, 5)
        const trades = calculateRebalanceTrades(portfolio)
        expect(trades[0]).toEqual({
            asset: 'XLM',
            action: 'buy',
            amount: 6000
        })
    })

    it('respects Stellar precision (8 decimal places) in math', () => {
        const portfolio = makePortfolio([
            { asset: 'XLM', current: 60, target: 50, amount: 6000.00000001 },
        ])
        const trades = calculateRebalanceTrades(portfolio)
        // targetValue = 10000 * 0.5 = 5000. diff = 5000 - 6000.00000001 = -1000.00000001
        expect(trades[0].amount).toBeCloseTo(1000.00000001, 8)
    })
})
