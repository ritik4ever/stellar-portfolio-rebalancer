import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express, { Express } from 'express'
import { ReflectorService } from '../services/reflector.js'
import { backtestRouter } from '../api/backtest.routes.js'
import { backtestStorage } from '../services/backtestStorage.js'
import { portfolioStorage } from '../services/portfolioStorage.js'
import { BacktestDataError, DAY_SECONDS } from '../services/backtest.js'

// Mock ReflectorService
const mockGetMarketPriceHistory = vi.fn()
vi.mock('../services/reflector.js', () => {
    return {
        ReflectorService: class {
            getMarketPriceHistory(...args: unknown[]) {
                return mockGetMarketPriceHistory(...args)
            }
        },
    }
})

describe('SPR-2026-153: State Consistency in Backtest Price Window', () => {
    let app: Express

    beforeEach(() => {
        vi.clearAllMocks()
        backtestStorage.clearMemory()

        app = express()
        app.use(express.json())
        app.use('/api/v1', backtestRouter)
        app.use('/api', backtestRouter)
    })

    // Fixture timestamps for leap year window: 2024-02-28, 2024-02-29, 2024-03-01
    const FEB_28_2024 = 1709078400 // 2024-02-28 00:00:00 UTC
    const FEB_29_2024 = 1709164800 // 2024-02-29 00:00:00 UTC (Leap Day)
    const MAR_01_2024 = 1709251200 // 2024-03-01 00:00:00 UTC

    const completeLeapWindowHistory = {
        XLM: [
            { timestamp: FEB_28_2024, price: 0.10 },
            { timestamp: FEB_29_2024, price: 0.12 }, // leap day quote
            { timestamp: MAR_01_2024, price: 0.11 },
        ],
        USDC: [
            { timestamp: FEB_28_2024, price: 1.0 },
            { timestamp: FEB_29_2024, price: 1.0 }, // leap day quote
            { timestamp: MAR_01_2024, price: 1.0 },
        ],
    }

    describe('State agreement after successful backtest', () => {
        it('persisted record and externally visible result agree completely on success', async () => {
            mockGetMarketPriceHistory.mockImplementation(async (asset: string) => {
                return completeLeapWindowHistory[asset as keyof typeof completeLeapWindowHistory] || []
            })

            const payload = {
                allocations: { XLM: 50, USDC: 50 },
                threshold: 5,
                days: 30,
                initialValue: 10_000,
                from: '2024-02-28T00:00:00.000Z',
                to: '2024-03-01T00:00:00.000Z',
            }

            const response = await request(app)
                .post('/api/v1/backtest')
                .send(payload)

            expect(response.status).toBe(200)
            expect(response.body.success).toBe(true)

            const data = response.body.data
            expect(data.id).toBeDefined()
            expect(data.status).toBe('completed')
            expect(data.hasLeapDay).toBe(true)
            expect(data.leapDayIncluded).toBe(true)
            expect(data.includedDays).toEqual(['2024-02-28', '2024-02-29', '2024-03-01'])
            expect(data.absentDayReasons).toEqual({})
            expect(data.decision.status).toBe('completed')
            expect(data.decision.includedDaysCount).toBe(3)

            // Verify the persisted record via GET /api/v1/backtest/:id
            const getRes = await request(app)
                .get(`/api/v1/backtest/${data.id}`)

            expect(getRes.status).toBe(200)
            expect(getRes.body.success).toBe(true)
            const persisted = getRes.body.data

            // Verify strict agreement between externally visible result and persisted record
            expect(persisted.id).toBe(data.id)
            expect(persisted.status).toBe('completed')
            expect(persisted.includedDays).toEqual(data.includedDays)
            expect(persisted.absentDayReasons).toEqual(data.absentDayReasons)
            expect(persisted.absentDays).toEqual(data.absentDays)
            expect(persisted.decision).toEqual(data.decision)
            expect(persisted.hasLeapDay).toBe(true)
            expect(persisted.leapDayIncluded).toBe(true)
            expect(persisted.result.finalValue).toBe(data.finalValue)
            expect(persisted.result.totalReturnPct).toBe(data.totalReturnPct)
            expect(persisted.result.rebalanceCount).toBe(data.rebalanceCount)
            expect(persisted.error).toBeUndefined()

            // Verify list query retrieves completed records
            const listRes = await request(app).get('/api/v1/backtest?status=completed')
            expect(listRes.status).toBe(200)
            expect(listRes.body.data.records.some((r: any) => r.id === data.id)).toBe(true)
        })
    })

    describe('State agreement after failure or interrupted work', () => {
        it('persisted record and externally visible result agree on market provider failure', async () => {
            mockGetMarketPriceHistory.mockRejectedValue(new Error('CoinGecko history API error: 503 Service Unavailable'))

            const payload = {
                allocations: { XLM: 60, USDC: 40 },
                threshold: 5,
                days: 30,
            }

            const response = await request(app)
                .post('/api/v1/backtest')
                .send(payload)

            expect(response.status).toBe(503)
            expect(response.body.success).toBe(false)
            expect(response.body.error.code).toBe('HISTORICAL_DATA_UNAVAILABLE')
            expect(response.body.error.message).toBe('Historical prices unavailable for XLM')

            const recordId = response.body.error.details?.recordId
            expect(recordId).toBeDefined()

            // Query the persisted record
            const getRes = await request(app).get(`/api/v1/backtest/${recordId}`)
            expect(getRes.status).toBe(200)
            const persisted = getRes.body.data

            // Verify agreement on failed state
            expect(persisted.id).toBe(recordId)
            expect(persisted.status).toBe('failed')
            expect(persisted.error).toBe(response.body.error.message)
            expect(persisted.includedDays).toEqual([])
            expect(persisted.result).toBeUndefined()
        })

        it('persists failure state when insufficient history causes simulation failure', async () => {
            // Provide only 1 day of quotes (runBacktest requires at least 2)
            mockGetMarketPriceHistory.mockResolvedValue([
                { timestamp: FEB_28_2024, price: 0.12 }
            ])

            const payload = {
                allocations: { XLM: 100 },
                threshold: 5,
                days: 7,
            }

            const response = await request(app)
                .post('/api/v1/backtest')
                .send(payload)

            expect(response.status).toBe(503)
            expect(response.body.error.code).toBe('HISTORICAL_DATA_UNAVAILABLE')
            expect(response.body.error.message).toBe('Not enough overlapping price history across the selected assets')

            const recordId = response.body.error.details?.recordId
            expect(recordId).toBeDefined()

            const getRes = await request(app).get(`/api/v1/backtest/${recordId}`)
            expect(getRes.status).toBe(200)
            const persisted = getRes.body.data

            expect(persisted.id).toBe(recordId)
            expect(persisted.status).toBe('failed')
            expect(persisted.error).toBe('Not enough overlapping price history across the selected assets')
        })

        it('recovers safely from interrupted work and releases worker lock', async () => {
            const portfolioId = 'portfolio-interrupted-test'
            vi.spyOn(portfolioStorage, 'getPortfolio').mockResolvedValue({
                id: portfolioId,
                userAddress: 'GBTEST123',
                name: 'Test Portfolio',
                allocations: { XLM: 50, USDC: 50 },
                threshold: 5,
                balances: {},
                totalValue: 1000,
                createdAt: new Date().toISOString(),
                lastRebalance: new Date().toISOString(),
                version: 1,
            })

            // Interrupted work: provider throws unexpected runtime error
            mockGetMarketPriceHistory.mockRejectedValue(new Error('Process interrupted: SIGTERM received during network call'))

            const response = await request(app)
                .post('/api/v1/backtest')
                .send({ portfolioId })

            expect(response.status).toBe(503)
            expect(response.body.error.details?.recordId).toBeDefined()

            // Lock must be cleanly released despite the interruption
            expect(backtestStorage.isLocked(portfolioId)).toBe(false)

            // Check that the interrupted record is marked failed
            const record = await backtestStorage.getRecord(response.body.error.details.recordId)
            expect(record?.status).toBe('failed')
            expect(record?.error).toBe(response.body.error.message)
            expect(record?.error).toBe('Historical prices unavailable for XLM')

            // Subsequent run on the same portfolio must not be blocked
            mockGetMarketPriceHistory.mockResolvedValue(completeLeapWindowHistory.XLM)
            const retryRes = await request(app)
                .post('/api/v1/backtest')
                .send({
                    portfolioId,
                    from: '2024-02-28T00:00:00.000Z',
                    to: '2024-03-01T00:00:00.000Z',
                })

            expect(retryRes.status).toBe(200)
            expect(retryRes.body.data.status).toBe('completed')
        })
    })

    describe('Concurrent work handling', () => {
        it('prevents concurrent conflicting work on the same portfolio with 409 CONFLICT', async () => {
            const portfolioId = 'portfolio-concurrent-test'
            vi.spyOn(portfolioStorage, 'getPortfolio').mockResolvedValue({
                id: portfolioId,
                userAddress: 'GBTEST123',
                name: 'Test Portfolio',
                allocations: { XLM: 50, USDC: 50 },
                threshold: 5,
                balances: {},
                totalValue: 1000,
                createdAt: new Date().toISOString(),
                lastRebalance: new Date().toISOString(),
                version: 1,
            })

            // Simulate lock already acquired by another worker/request
            await backtestStorage.acquireLock(portfolioId)

            const response = await request(app)
                .post('/api/v1/backtest')
                .send({ portfolioId })

            expect(response.status).toBe(409)
            expect(response.body.success).toBe(false)
            expect(response.body.error.code).toBe('CONFLICT')
            expect(response.body.error.message).toBe('Backtest already in progress for this portfolio')

            // Release lock and verify work can proceed
            await backtestStorage.releaseLock(portfolioId)
            mockGetMarketPriceHistory.mockResolvedValue(completeLeapWindowHistory.XLM)

            const followUpRes = await request(app)
                .post('/api/v1/backtest')
                .send({
                    portfolioId,
                    from: '2024-02-28T00:00:00.000Z',
                    to: '2024-03-01T00:00:00.000Z',
                })

            expect(followUpRes.status).toBe(200)
            expect(followUpRes.body.data.status).toBe('completed')
        })

        it('isolates included days and absent-day reasons across concurrent independent executions', async () => {
            // Execution A: XLM and USDC have complete quotes on leap day
            // Execution B: BTC and ETH, where ETH lacks a quote on leap day (absentDayReason)
            mockGetMarketPriceHistory.mockImplementation(async (asset: string) => {
                if (asset === 'XLM' || asset === 'USDC') {
                    return completeLeapWindowHistory[asset as keyof typeof completeLeapWindowHistory]
                }
                if (asset === 'BTC') {
                    return [
                        { timestamp: FEB_28_2024, price: 60000 },
                        { timestamp: FEB_29_2024, price: 62000 }, // leap day quote
                        { timestamp: MAR_01_2024, price: 61000 },
                    ]
                }
                if (asset === 'ETH') {
                    return [
                        { timestamp: FEB_28_2024, price: 3000 },
                        // Missing 2024-02-29!
                        { timestamp: MAR_01_2024, price: 3100 },
                    ]
                }
                return []
            })

            const requestA = request(app)
                .post('/api/v1/backtest')
                .send({
                    allocations: { XLM: 50, USDC: 50 },
                    threshold: 5,
                    from: '2024-02-28T00:00:00.000Z',
                    to: '2024-03-01T00:00:00.000Z',
                })

            const requestB = request(app)
                .post('/api/v1/backtest')
                .send({
                    allocations: { BTC: 50, ETH: 50 },
                    threshold: 5,
                    from: '2024-02-28T00:00:00.000Z',
                    to: '2024-03-01T00:00:00.000Z',
                })

            // Execute concurrently
            const [resA, resB] = await Promise.all([requestA, requestB])

            expect(resA.status).toBe(200)
            expect(resB.status).toBe(200)

            const dataA = resA.body.data
            const dataB = resB.body.data

            // Execution A assertions: leap day included
            expect(dataA.hasLeapDay).toBe(true)
            expect(dataA.leapDayIncluded).toBe(true)
            expect(dataA.includedDays).toEqual(['2024-02-28', '2024-02-29', '2024-03-01'])
            expect(dataA.absentDayReasons).toEqual({})

            // Execution B assertions: leap day absent with explicit reason
            expect(dataB.hasLeapDay).toBe(true)
            expect(dataB.leapDayIncluded).toBe(false)
            expect(dataB.includedDays).toEqual(['2024-02-28', '2024-03-01'])
            expect(dataB.absentDayReasons['2024-02-29']).toBe(
                'Leap day price feed unavailable for asset(s): ETH'
            )

            // Verify persisted records for A and B remain strictly isolated
            const recordA = await backtestStorage.getRecord(dataA.id)
            const recordB = await backtestStorage.getRecord(dataB.id)

            expect(recordA?.includedDays).toEqual(['2024-02-28', '2024-02-29', '2024-03-01'])
            expect(recordA?.absentDayReasons).toEqual({})

            expect(recordB?.includedDays).toEqual(['2024-02-28', '2024-03-01'])
            expect(recordB?.absentDayReasons['2024-02-29']).toBe(
                'Leap day price feed unavailable for asset(s): ETH'
            )
        })
    })

    describe('Portfolio backtest workflow routes', () => {
        it('supports POST and GET /api/portfolio/:id/backtest with portfolio context', async () => {
            const portfolioId = 'portfolio-workflow-153'
            vi.spyOn(portfolioStorage, 'getPortfolio').mockResolvedValue({
                id: portfolioId,
                userAddress: 'GBTEST153',
                name: 'Workflow Portfolio',
                allocations: { XLM: 70, USDC: 30 },
                threshold: 8,
                balances: {},
                totalValue: 5000,
                createdAt: new Date().toISOString(),
                lastRebalance: new Date().toISOString(),
                version: 1,
            })

            mockGetMarketPriceHistory.mockImplementation(async (asset: string) => {
                return completeLeapWindowHistory[asset as keyof typeof completeLeapWindowHistory] || []
            })

            const postRes = await request(app)
                .post(`/api/portfolio/${portfolioId}/backtest`)
                .send({
                    days: 30,
                    from: '2024-02-28T00:00:00.000Z',
                    to: '2024-03-01T00:00:00.000Z',
                })

            expect(postRes.status).toBe(200)
            expect(postRes.body.data.id).toBeDefined()
            expect(postRes.body.data.allocations).toEqual({ XLM: 70, USDC: 30 })
            expect(postRes.body.data.threshold).toBe(8)

            const listRes = await request(app).get(`/api/portfolio/${portfolioId}/backtests`)
            expect(listRes.status).toBe(200)
            expect(listRes.body.data.records.length).toBeGreaterThanOrEqual(1)
            expect(listRes.body.data.records[0].portfolioId).toBe(portfolioId)
        })

        it('returns 404 for GET /api/v1/backtest/:id when record does not exist', async () => {
            const res = await request(app).get('/api/v1/backtest/non-existent-id')
            expect(res.status).toBe(404)
            expect(res.body.error.code).toBe('NOT_FOUND')
        })
    })
})
