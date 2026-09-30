/**
 * Tests for the historical rebalance simulator (#1855): the pure engine and
 * POST /backtest, which must only ever run on real (non-synthetic) prices.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import {
    runBacktest,
    toDailyCloses,
    fetchBacktestHistory,
    BacktestDataError,
    BACKTEST_DISCLAIMER,
} from '../services/backtest.js'

const { mockGetMarketPriceHistory, mockGetPriceHistory } = vi.hoisted(() => ({
    mockGetMarketPriceHistory: vi.fn(),
    mockGetPriceHistory: vi.fn(),
}))

vi.mock('../services/reflector.js', () => ({
    ReflectorService: class {
        getMarketPriceHistory = mockGetMarketPriceHistory
        getPriceHistory = mockGetPriceHistory
    },
}))

const DAY = 24 * 60 * 60
const START = 1_700_006_400 // UTC midnight

function series(prices: number[]) {
    return prices.map((price, i) => ({ timestamp: START + i * DAY, price }))
}

describe('toDailyCloses', () => {
    it('keeps the last price of each UTC day and drops invalid prices', () => {
        const closes = toDailyCloses([
            { timestamp: START + 60, price: 1 },
            { timestamp: START + 3600, price: 2 },
            { timestamp: START + DAY + 10, price: 0 },
            { timestamp: START + DAY + 20, price: 5 },
        ])
        expect([...closes.entries()]).toEqual([
            [START, 2],
            [START + DAY, 5],
        ])
    })
})

describe('runBacktest', () => {
    const allocations = { XLM: 50, USDC: 50 }

    it('rebalances only when drift exceeds the threshold', () => {
        // XLM doubles on day 1: 66.7/33.3 split → 16.7pp drift.
        const history = { XLM: series([1, 2, 2]), USDC: series([1, 1, 1]) }

        const loose = runBacktest({ allocations, threshold: 20, initialValue: 1000, history })
        expect(loose.rebalanceCount).toBe(0)
        expect(loose.finalValue).toBe(loose.buyAndHoldFinalValue)

        const tight = runBacktest({ allocations, threshold: 10, initialValue: 1000, history })
        expect(tight.rebalanceCount).toBe(1)
        // With two assets both drift by the same amount, so either may be reported.
        expect(tight.events[0]).toMatchObject({ timestamp: START + DAY, maxDriftPct: 16.67 })
        expect(['XLM', 'USDC']).toContain(tight.events[0].asset)
        expect(tight.timeline.map((p) => p.rebalanced)).toEqual([false, true, false])
    })

    it('captures mean-reversion gains that buy-and-hold misses', () => {
        const history = { XLM: series([1, 2, 1]), USDC: series([1, 1, 1]) }
        const result = runBacktest({ allocations, threshold: 5, initialValue: 1000, history })

        expect(result.buyAndHoldFinalValue).toBe(1000)
        expect(result.finalValue).toBeGreaterThan(1000)
        expect(result.totalReturnPct).toBeGreaterThan(result.buyAndHoldReturnPct)
        expect(result.maxDrawdownPct).toBeGreaterThan(0)
    })

    it('conserves value when accepted allocations total slightly off 100', () => {
        // Validation accepts totals within 0.01 of 100.
        const history = { XLM: series([1, 2, 1, 2]), USDC: series([1, 1, 1, 1]) }
        const flatPrices = { XLM: series([1, 1]), USDC: series([1, 1]) }

        const flat = runBacktest({ allocations: { XLM: 50, USDC: 50.005 }, threshold: 5, initialValue: 1000, history: flatPrices })
        expect(flat.timeline[0].value).toBe(1000)
        expect(flat.finalValue).toBe(1000)

        const exact = runBacktest({ allocations: { XLM: 50, USDC: 50 }, threshold: 5, initialValue: 1000, history })
        const offBy = runBacktest({ allocations: { XLM: 50, USDC: 50.005 }, threshold: 5, initialValue: 1000, history })
        expect(offBy.rebalanceCount).toBe(exact.rebalanceCount)
        expect(Math.abs(offBy.finalValue - exact.finalValue)).toBeLessThan(0.5)
    })

    it('only simulates days where every asset has a real price', () => {
        const history = {
            XLM: series([1, 1.1, 1.2, 1.3]),
            USDC: [series([1, 1, 1, 1])[0], series([1, 1, 1, 1])[3]],
        }
        const result = runBacktest({ allocations, threshold: 5, initialValue: 1000, history })
        expect(result.days).toBe(2)
        expect(result.timeline.map((p) => p.timestamp)).toEqual([START, START + 3 * DAY])
    })

    it('rejects assets with no or insufficient history', () => {
        expect(() =>
            runBacktest({ allocations, threshold: 5, initialValue: 1000, history: { XLM: series([1, 2]) } }),
        ).toThrow(BacktestDataError)
        expect(() =>
            runBacktest({
                allocations,
                threshold: 5,
                initialValue: 1000,
                history: { XLM: series([1]), USDC: series([1]) },
            }),
        ).toThrow(BacktestDataError)
    })
})

describe('fetchBacktestHistory', () => {
    it('drops points from the still-open current UTC day', async () => {
        const now = (START + 2 * DAY + 3600) * 1000
        const reflector = {
            getMarketPriceHistory: vi.fn(async () => [
                { timestamp: START, price: 1 },
                { timestamp: START + DAY, price: 2 },
                { timestamp: START + 2 * DAY, price: 3 },
                { timestamp: START + 2 * DAY + 1800, price: 4 },
            ]),
        }

        const history = await fetchBacktestHistory(reflector, ['XLM'], 7, now)
        expect(history.XLM.map((p) => p.price)).toEqual([1, 2])
    })
})

describe('POST /backtest', () => {
    let app: express.Express

    beforeEach(async () => {
        vi.clearAllMocks()
        const { backtestRouter } = await import('../api/backtest.routes.js')
        app = express()
        app.use(express.json())
        app.use('/api/v1', backtestRouter)
    })

    it('returns a labelled historical simulation built from real price history', async () => {
        mockGetMarketPriceHistory.mockImplementation(async (asset: string) =>
            asset === 'XLM' ? series([1, 2, 1]) : series([1, 1, 1]),
        )

        const res = await request(app)
            .post('/api/v1/backtest')
            .send({ allocations: { XLM: 50, USDC: 50 }, threshold: 5, days: 30 })

        expect(res.status).toBe(200)
        expect(res.body.data).toMatchObject({
            simulated: true,
            dataSource: 'coingecko_market_chart',
            disclaimer: BACKTEST_DISCLAIMER,
            threshold: 5,
            initialValue: 10_000,
            rebalanceCount: 2,
        })
        expect(mockGetMarketPriceHistory).toHaveBeenCalledWith('XLM', 30)
        expect(mockGetPriceHistory).not.toHaveBeenCalled()
    })

    it('returns 503 instead of falling back to synthetic prices', async () => {
        mockGetMarketPriceHistory.mockRejectedValue(new Error('CoinGecko history API error: 429'))

        const res = await request(app)
            .post('/api/v1/backtest')
            .send({ allocations: { XLM: 50, USDC: 50 }, threshold: 5 })

        expect(res.status).toBe(503)
        expect(res.body.error.code).toBe('HISTORICAL_DATA_UNAVAILABLE')
        expect(res.body.error.message).toBe('Historical prices unavailable for XLM')
        expect(mockGetPriceHistory).not.toHaveBeenCalled()
    })

    it.each([
        [{ allocations: { XLM: 60, USDC: 30 }, threshold: 5 }],
        [{ allocations: { XLM: 50, USDC: 50 }, threshold: 0.5 }],
        [{ allocations: { XLM: 50, USDC: 50 }, threshold: 5, days: 1000 }],
    ])('rejects invalid input %#', async (body) => {
        const res = await request(app).post('/api/v1/backtest').send(body)
        expect(res.status).toBe(422)
        expect(mockGetMarketPriceHistory).not.toHaveBeenCalled()
    })
})
