import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const {
    mockGetMarketPriceHistory,
    mockGetPriceHistory,
    mockInsertBacktestRecord,
    mockUpdateBacktestRecord,
} = vi.hoisted(() => ({
    mockGetMarketPriceHistory: vi.fn(),
    mockGetPriceHistory: vi.fn(),
    mockInsertBacktestRecord: vi.fn(),
    mockUpdateBacktestRecord: vi.fn(),
}))

vi.mock('../db/client.js', () => ({
    isDbConfigured: vi.fn(() => false),
}))

vi.mock('../services/databaseService.js', () => ({
    databaseService: {
        insertBacktestRecord: mockInsertBacktestRecord,
        updateBacktestRecord: mockUpdateBacktestRecord,
        getBacktestRecord: vi.fn(),
        getBacktestRecordsByPortfolio: vi.fn(),
        listBacktestRecords: vi.fn(),
    },
}))

vi.mock('../services/reflector.js', () => ({
    ReflectorService: class {
        getMarketPriceHistory = mockGetMarketPriceHistory
        getPriceHistory = mockGetPriceHistory
    },
}))

import { backtestRouter } from '../api/backtest.routes.js'
import { backtestStorage } from '../services/backtestStorage.js'
import { DAY_SECONDS } from '../services/backtest.js'

const FEB_27_2024 = 1_708_992_000
const DATE_RANGE = {
    from: '2024-02-27T00:00:00.000Z',
    to: '2024-03-01T00:00:00.000Z',
}

function series(start: number, prices: number[]) {
    return prices.map((price, index) => ({
        timestamp: start + index * DAY_SECONDS,
        price,
    }))
}

describe('backtest historical price window', () => {
    let app: express.Express

    beforeEach(() => {
        vi.clearAllMocks()
        backtestStorage.clearMemory()
        app = express()
        app.use(express.json())
        app.use('/api/v1', backtestRouter)
    })

    function expectSingleBacktestSideEffects() {
        expect(mockInsertBacktestRecord).toHaveBeenCalledTimes(1)
        expect(mockUpdateBacktestRecord).toHaveBeenCalledTimes(1)
        expect(mockGetMarketPriceHistory).toHaveBeenCalledTimes(2)
        expect(mockGetMarketPriceHistory).toHaveBeenCalledWith('XLM', expect.any(Number))
        expect(mockGetMarketPriceHistory).toHaveBeenCalledWith('USDC', expect.any(Number))
        expect(mockGetPriceHistory).not.toHaveBeenCalled()
    }

    it('includes February 29 in a historical price window', async () => {
        mockGetMarketPriceHistory.mockImplementation(async (asset: string) =>
            asset === 'XLM'
                ? series(FEB_27_2024, [1, 1.1, 1.2, 1.3])
                : series(FEB_27_2024, [1, 1, 1, 1]),
        )

        const response = await request(app)
            .post('/api/v1/backtest')
            .send({
                allocations: { XLM: 50, USDC: 50 },
                threshold: 5,
                days: 30,
                ...DATE_RANGE,
            })

        expect(response.status).toBe(200)
        expect(response.body.data.includedDays).toEqual([
            '2024-02-27',
            '2024-02-28',
            '2024-02-29',
            '2024-03-01',
        ])
        expect(response.body.data.absentDayReasons).toEqual({})
        expect(response.body.data.absentDays).toEqual([])
        expect(response.body.data.decision).toMatchObject({
            totalWindowDays: 4,
            includedDaysCount: 4,
            absentDaysCount: 0,
            hasLeapDay: true,
            leapDayIncluded: true,
        })

        expectSingleBacktestSideEffects()
        expect(mockUpdateBacktestRecord.mock.calls[0][1]).toMatchObject({
            status: 'completed',
            includedDays: response.body.data.includedDays,
            absentDayReasons: {},
        })
    })

    it('reports a missing leap-day quote from an incomplete history feed once', async () => {
        mockGetMarketPriceHistory.mockImplementation(async (asset: string) =>
            asset === 'XLM'
                ? [
                    { timestamp: FEB_27_2024, price: 1 },
                    { timestamp: FEB_27_2024 + DAY_SECONDS, price: 1.1 },
                    { timestamp: FEB_27_2024 + 3 * DAY_SECONDS, price: 1.3 },
                ]
                : series(FEB_27_2024, [1, 1, 1, 1]),
        )

        const response = await request(app)
            .post('/api/v1/backtest')
            .send({
                allocations: { XLM: 50, USDC: 50 },
                threshold: 5,
                days: 30,
                ...DATE_RANGE,
            })

        const missingLeapDayReason = 'Leap day price feed unavailable for asset(s): XLM'
        expect(response.status).toBe(200)
        expect(response.body.data.includedDays).toEqual([
            '2024-02-27',
            '2024-02-28',
            '2024-03-01',
        ])
        expect(response.body.data.absentDayReasons).toEqual({
            '2024-02-29': missingLeapDayReason,
        })
        expect(response.body.data.absentDays).toMatchObject([{
            date: '2024-02-29',
            isLeapDay: true,
            missingAssets: ['XLM'],
            reason: missingLeapDayReason,
        }])
        expect(response.body.data.decision).toMatchObject({
            totalWindowDays: 4,
            includedDaysCount: 3,
            absentDaysCount: 1,
            hasLeapDay: true,
            leapDayIncluded: false,
        })

        expectSingleBacktestSideEffects()
        expect(mockUpdateBacktestRecord.mock.calls[0][1]).toMatchObject({
            status: 'completed',
            includedDays: response.body.data.includedDays,
            absentDayReasons: { '2024-02-29': missingLeapDayReason },
        })
    })
})
