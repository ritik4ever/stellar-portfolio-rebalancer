/**
 * Tests for the historical rebalance simulator and boundary handling (SPR-2026-151):
 * - Pure backtest simulation engine
 * - Leap day and historical range boundary handling at the service boundary
 * - Identification of included days and absent-day reasons with stable results
 * - POST /api/v1/backtest and POST /api/backtest endpoints
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import {
    runBacktest,
    toDailyCloses,
    fetchBacktestHistory,
    formatUtcDate,
    isLeapDay,
    isLeapYear,
    BacktestDataError,
    BACKTEST_DISCLAIMER,
    DAY_SECONDS,
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

// Unix timestamp for 2024-02-27 00:00:00 UTC (leap year window)
const LEAP_WINDOW_START = 1_708_992_000 // 2024-02-27T00:00:00Z
// Standard reference timestamp (2023-11-15T00:00:00Z)
const STANDARD_START = 1_700_006_400

function series(startTs: number, prices: number[]) {
    return prices.map((price, i) => ({ timestamp: startTs + i * DAY_SECONDS, price }))
}

describe('Date & Leap Year Utilities (SPR-2026-151)', () => {
    it('accurately identifies leap years', () => {
        expect(isLeapYear(2020)).toBe(true)
        expect(isLeapYear(2024)).toBe(true)
        expect(isLeapYear(2028)).toBe(true)
        expect(isLeapYear(2000)).toBe(true)

        expect(isLeapYear(2021)).toBe(false)
        expect(isLeapYear(2022)).toBe(false)
        expect(isLeapYear(2023)).toBe(false)
        expect(isLeapYear(1900)).toBe(false)
        expect(isLeapYear(2100)).toBe(false)
    })

    it('accurately detects leap day (Feb 29 UTC) and normal days', () => {
        // 2024-02-28 00:00:00 UTC
        const feb28 = 1_709_078_400
        // 2024-02-29 00:00:00 UTC (leap day!)
        const feb29 = 1_709_164_800
        // 2024-03-01 00:00:00 UTC
        const mar01 = 1_709_251_200

        expect(isLeapDay(feb28)).toBe(false)
        expect(isLeapDay(feb29)).toBe(true)
        expect(isLeapDay(mar01)).toBe(false)

        expect(formatUtcDate(feb28)).toBe('2024-02-28')
        expect(formatUtcDate(feb29)).toBe('2024-02-29')
        expect(formatUtcDate(mar01)).toBe('2024-03-01')
    })
})

describe('toDailyCloses', () => {
    it('keeps the last price of each UTC day and drops invalid prices', () => {
        const closes = toDailyCloses([
            { timestamp: STANDARD_START + 60, price: 1 },
            { timestamp: STANDARD_START + 3600, price: 2 },
            { timestamp: STANDARD_START + DAY_SECONDS + 10, price: 0 },
            { timestamp: STANDARD_START + DAY_SECONDS + 20, price: 5 },
            { timestamp: STANDARD_START + 2 * DAY_SECONDS, price: -1 },
            { timestamp: STANDARD_START + 2 * DAY_SECONDS + 10, price: Number.NaN },
        ])
        expect([...closes.entries()]).toEqual([
            [STANDARD_START, 2],
            [STANDARD_START + DAY_SECONDS, 5],
        ])
    })

    it('faithfully preserves leap day price snapshot', () => {
        const feb29Noon = 1_709_208_000 // 2024-02-29 12:00:00 UTC
        const closes = toDailyCloses([{ timestamp: feb29Noon, price: 42.5 }])
        const [dayTs, price] = [...closes.entries()][0]
        expect(dayTs).toBe(1_709_164_800) // 2024-02-29 00:00:00 UTC
        expect(price).toBe(42.5)
        expect(formatUtcDate(dayTs)).toBe('2024-02-29')
    })
})

describe('runBacktest — Service Boundary & Leap Day Handling (SPR-2026-151)', () => {
    const allocations = { XLM: 50, USDC: 50 }

    it('correctly includes a leap day in historical range when quotes are complete', () => {
        // Range: 2024-02-27, 2024-02-28, 2024-02-29 (leap day), 2024-03-01
        const history = {
            XLM: series(LEAP_WINDOW_START, [1.0, 1.0, 1.25, 1.25]),
            USDC: series(LEAP_WINDOW_START, [1.0, 1.0, 1.0, 1.0]),
        }

        const result = runBacktest({
            allocations,
            threshold: 5,
            initialValue: 10_000,
            history,
        })

        expect(result.days).toBe(4)
        expect(result.startDate).toBe('2024-02-27')
        expect(result.endDate).toBe('2024-03-01')

        // Acceptance Criteria: includedDays must document all included dates
        expect(result.includedDays).toEqual([
            '2024-02-27',
            '2024-02-28',
            '2024-02-29',
            '2024-03-01',
        ])
        expect(result.includedDays).toContain('2024-02-29')
        expect(result.absentDayReasons).toEqual({})
        expect(result.absentDays).toHaveLength(0)

        // Decision document checks
        expect(result.decision).toMatchObject({
            status: 'completed',
            totalWindowDays: 4,
            includedDaysCount: 4,
            absentDaysCount: 0,
            hasLeapDay: true,
            leapDayIncluded: true,
        })
        expect(result.decision.evaluationSummary).toContain('leap day (Feb 29) successfully included')

        // Drift check on leap day (1.25 vs 1.0 -> 55.56% vs 44.44% -> 5.56% drift > 5% threshold)
        expect(result.rebalanceCount).toBeGreaterThan(0)
        expect(result.events.some((e) => e.date === '2024-02-29')).toBe(true)
    })

    it('explicitly records absent-day reasons when leap day quote is missing for an asset', () => {
        // XLM has prices for all 4 days; USDC is missing on Feb 29
        const feb27 = LEAP_WINDOW_START
        const feb28 = feb27 + DAY_SECONDS
        const feb29 = feb28 + DAY_SECONDS
        const mar01 = feb29 + DAY_SECONDS

        const history = {
            XLM: [
                { timestamp: feb27, price: 1.0 },
                { timestamp: feb28, price: 1.0 },
                { timestamp: feb29, price: 1.2 },
                { timestamp: mar01, price: 1.2 },
            ],
            USDC: [
                { timestamp: feb27, price: 1.0 },
                { timestamp: feb28, price: 1.0 },
                // Missing Feb 29 for USDC
                { timestamp: mar01, price: 1.0 },
            ],
        }

        const result = runBacktest({
            allocations,
            threshold: 10,
            initialValue: 10_000,
            history,
        })

        // 3 days simulated: Feb 27, Feb 28, Mar 01
        expect(result.days).toBe(3)
        expect(result.includedDays).toEqual(['2024-02-27', '2024-02-28', '2024-03-01'])
        expect(result.includedDays).not.toContain('2024-02-29')

        // Acceptance Criteria: absent-day reasons documents reason for missing leap day
        expect(result.absentDayReasons['2024-02-29']).toBe(
            'Leap day price feed unavailable for asset(s): USDC',
        )
        expect(result.absentDays).toHaveLength(1)
        expect(result.absentDays[0]).toMatchObject({
            date: '2024-02-29',
            isLeapDay: true,
            missingAssets: ['USDC'],
            reason: 'Leap day price feed unavailable for asset(s): USDC',
        })

        // Decision documents the omission with stable result
        expect(result.decision).toMatchObject({
            status: 'completed',
            totalWindowDays: 4,
            includedDaysCount: 3,
            absentDaysCount: 1,
            hasLeapDay: true,
            leapDayIncluded: false,
        })
        expect(result.decision.absentDayReasons['2024-02-29']).toBe(
            'Leap day price feed unavailable for asset(s): USDC',
        )
        expect(result.decision.evaluationSummary).toContain('leap day (Feb 29) absent')
    })

    it('documents absent days and reasons for sparse price series across standard window', () => {
        // XLM has days 0, 1, 2, 3; USDC is missing day 1 and day 2
        const history = {
            XLM: series(STANDARD_START, [1.0, 1.1, 1.2, 1.3]),
            USDC: [
                { timestamp: STANDARD_START, price: 1.0 },
                // missing day 1 and day 2
                { timestamp: STANDARD_START + 3 * DAY_SECONDS, price: 1.0 },
            ],
        }

        const result = runBacktest({
            allocations,
            threshold: 5,
            initialValue: 10_000,
            history,
        })

        expect(result.days).toBe(2)
        expect(result.includedDays).toEqual([
            formatUtcDate(STANDARD_START),
            formatUtcDate(STANDARD_START + 3 * DAY_SECONDS),
        ])

        const day1Str = formatUtcDate(STANDARD_START + DAY_SECONDS)
        const day2Str = formatUtcDate(STANDARD_START + 2 * DAY_SECONDS)

        expect(result.absentDayReasons[day1Str]).toBe('Missing price data for asset(s): USDC')
        expect(result.absentDayReasons[day2Str]).toBe('Missing price data for asset(s): USDC')
        expect(result.absentDays).toHaveLength(2)
        expect(result.decision.absentDaysCount).toBe(2)
        expect(result.decision.includedDaysCount).toBe(2)
    })

    it('rebalances only when drift exceeds the threshold', () => {
        // XLM doubles on day 1: 66.7/33.3 split → 16.7pp drift.
        const history = {
            XLM: series(STANDARD_START, [1, 2, 2]),
            USDC: series(STANDARD_START, [1, 1, 1]),
        }

        const loose = runBacktest({ allocations, threshold: 20, initialValue: 1000, history })
        expect(loose.rebalanceCount).toBe(0)
        expect(loose.finalValue).toBe(loose.buyAndHoldFinalValue)

        const tight = runBacktest({ allocations, threshold: 10, initialValue: 1000, history })
        expect(tight.rebalanceCount).toBe(1)
        expect(tight.events[0]).toMatchObject({
            timestamp: STANDARD_START + DAY_SECONDS,
            maxDriftPct: 16.67,
        })
        expect(['XLM', 'USDC']).toContain(tight.events[0].asset)
        expect(tight.timeline.map((p) => p.rebalanced)).toEqual([false, true, false])
    })

    it('captures mean-reversion gains that buy-and-hold misses', () => {
        const history = {
            XLM: series(STANDARD_START, [1, 2, 1]),
            USDC: series(STANDARD_START, [1, 1, 1]),
        }
        const result = runBacktest({ allocations, threshold: 5, initialValue: 1000, history })

        expect(result.buyAndHoldFinalValue).toBe(1000)
        expect(result.finalValue).toBeGreaterThan(1000)
        expect(result.totalReturnPct).toBeGreaterThan(result.buyAndHoldReturnPct)
        expect(result.maxDrawdownPct).toBeGreaterThan(0)
    })

    it('conserves value when accepted allocations total slightly off 100', () => {
        const history = {
            XLM: series(STANDARD_START, [1, 2, 1, 2]),
            USDC: series(STANDARD_START, [1, 1, 1, 1]),
        }
        const exact = runBacktest({ allocations: { XLM: 50, USDC: 50 }, threshold: 5, initialValue: 1000, history })
        const offBy = runBacktest({ allocations: { XLM: 50, USDC: 50.005 }, threshold: 5, initialValue: 1000, history })
        expect(offBy.rebalanceCount).toBe(exact.rebalanceCount)
        expect(Math.abs(offBy.finalValue - exact.finalValue)).toBeLessThan(0.5)
    })

    it('rejects assets with no or insufficient history', () => {
        expect(() =>
            runBacktest({
                allocations,
                threshold: 5,
                initialValue: 1000,
                history: { XLM: series(STANDARD_START, [1, 2]) },
            }),
        ).toThrow(BacktestDataError)

        expect(() =>
            runBacktest({
                allocations,
                threshold: 5,
                initialValue: 1000,
                history: {
                    XLM: series(STANDARD_START, [1]),
                    USDC: series(STANDARD_START, [1]),
                },
            }),
        ).toThrow(BacktestDataError)
    })
})

describe('fetchBacktestHistory', () => {
    it('drops points from the still-open current UTC day and handles date range', async () => {
        const now = (STANDARD_START + 2 * DAY_SECONDS + 3600) * 1000
        const reflector = {
            getMarketPriceHistory: vi.fn(async () => [
                { timestamp: STANDARD_START, price: 1 },
                { timestamp: STANDARD_START + DAY_SECONDS, price: 2 },
                { timestamp: STANDARD_START + 2 * DAY_SECONDS, price: 3 },
                { timestamp: STANDARD_START + 2 * DAY_SECONDS + 1800, price: 4 },
            ]),
        }

        const history = await fetchBacktestHistory(reflector, ['XLM'], 7, now)
        expect(history.XLM.map((p) => p.price)).toEqual([1, 2])
    })

    it('applies explicit from and to range bounds', async () => {
        const now = (STANDARD_START + 5 * DAY_SECONDS) * 1000
        const reflector = {
            getMarketPriceHistory: vi.fn(async () => [
                { timestamp: STANDARD_START, price: 10 },
                { timestamp: STANDARD_START + DAY_SECONDS, price: 20 },
                { timestamp: STANDARD_START + 2 * DAY_SECONDS, price: 30 },
                { timestamp: STANDARD_START + 3 * DAY_SECONDS, price: 40 },
            ]),
        }

        const from = new Date((STANDARD_START + DAY_SECONDS) * 1000).toISOString()
        const to = new Date((STANDARD_START + 2 * DAY_SECONDS) * 1000).toISOString()

        const history = await fetchBacktestHistory(reflector, ['XLM'], 7, now, { from, to })
        expect(history.XLM.map((p) => p.price)).toEqual([20, 30])
    })
})

describe('POST /api/v1/backtest & POST /api/backtest', () => {
    let app: express.Express

    beforeEach(async () => {
        vi.clearAllMocks()
        const { portfolioRouter } = await import('../api/routes.js')
        app = express()
        app.use(express.json())
        app.use('/api/v1', portfolioRouter)
        app.use('/api', portfolioRouter)
    })

    it('returns 200 with includedDays and decision including leap day', async () => {
        mockGetMarketPriceHistory.mockImplementation(async (asset: string) => {
            if (asset === 'XLM') {
                return series(LEAP_WINDOW_START, [1.0, 1.2, 1.4, 1.1])
            }
            return series(LEAP_WINDOW_START, [1.0, 1.0, 1.0, 1.0])
        })

        const res = await request(app)
            .post('/api/v1/backtest')
            .send({
                allocations: { XLM: 50, USDC: 50 },
                threshold: 5,
                days: 30,
            })

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data).toMatchObject({
            simulated: true,
            dataSource: 'coingecko_market_chart',
            disclaimer: BACKTEST_DISCLAIMER,
            threshold: 5,
            initialValue: 10_000,
        })

        // Verify Acceptance Criteria: response includes days and decision documents status
        expect(res.body.data.includedDays).toContain('2024-02-29')
        expect(res.body.data.decision).toMatchObject({
            status: 'completed',
            hasLeapDay: true,
            leapDayIncluded: true,
        })
        expect(res.body.data.decision.evaluationSummary).toContain('leap day (Feb 29) successfully included')

        expect(mockGetMarketPriceHistory).toHaveBeenCalledWith('XLM', 30)
        expect(mockGetPriceHistory).not.toHaveBeenCalled()
    })

    it('returns absent-day reasons when price data is missing on leap day', async () => {
        mockGetMarketPriceHistory.mockImplementation(async (asset: string) => {
            const feb27 = LEAP_WINDOW_START
            const feb28 = feb27 + DAY_SECONDS
            const feb29 = feb28 + DAY_SECONDS
            const mar01 = feb29 + DAY_SECONDS

            if (asset === 'XLM') {
                return [
                    { timestamp: feb27, price: 1.0 },
                    { timestamp: feb28, price: 1.1 },
                    { timestamp: feb29, price: 1.2 },
                    { timestamp: mar01, price: 1.3 },
                ]
            }
            // USDC missing Feb 29
            return [
                { timestamp: feb27, price: 1.0 },
                { timestamp: feb28, price: 1.0 },
                { timestamp: mar01, price: 1.0 },
            ]
        })

        const res = await request(app)
            .post('/api/v1/backtest')
            .send({
                allocations: { XLM: 50, USDC: 50 },
                threshold: 5,
                days: 30,
            })

        expect(res.status).toBe(200)
        expect(res.body.data.includedDays).not.toContain('2024-02-29')
        expect(res.body.data.absentDayReasons['2024-02-29']).toBe(
            'Leap day price feed unavailable for asset(s): USDC',
        )
        expect(res.body.data.decision.leapDayIncluded).toBe(false)
        expect(res.body.data.decision.absentDayReasons['2024-02-29']).toBe(
            'Leap day price feed unavailable for asset(s): USDC',
        )
    })

    it('works on legacy /api/backtest path', async () => {
        mockGetMarketPriceHistory.mockImplementation(async (asset: string) =>
            asset === 'XLM' ? series(STANDARD_START, [1, 2, 1]) : series(STANDARD_START, [1, 1, 1]),
        )

        const res = await request(app)
            .post('/api/backtest')
            .send({ allocations: { XLM: 50, USDC: 50 }, threshold: 5, days: 30 })

        expect(res.status).toBe(200)
        expect(res.body.data.simulated).toBe(true)
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
        [{ allocations: { XLM: 50, USDC: 50 }, threshold: 5, from: 'invalid-date', to: 'invalid-date' }],
    ])('rejects invalid input %# with 422', async (body) => {
        const res = await request(app).post('/api/v1/backtest').send(body)
        expect(res.status).toBe(422)
        expect(mockGetMarketPriceHistory).not.toHaveBeenCalled()
    })
})
