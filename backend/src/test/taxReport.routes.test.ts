/**
 * Integration tests for GET /api/portfolio/tax-report
 *
 * Verifies FIFO tax report computation, CSV output, and year validation
 * for the mounted taxReportRouter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { portfolioRouter } from '../api/routes.js'
import { databaseService } from '../services/databaseService.js'

vi.mock('../services/assetRegistryService.js', () => ({
    assetRegistryService: {
        getBySymbol: vi.fn((symbol: string) => ({
            symbol,
            enabled: true,
            isQuarantined: false,
        })),
    },
}))

vi.mock('../services/databaseService.js', () => ({
    databaseService: {
        hasFullConsent: vi.fn(() => true),
        getAssetBySymbol: vi.fn((symbol: string) => ({
            symbol,
            enabled: true,
            isQuarantined: false,
        })),
        getRebalanceHistoryByDateRange: vi.fn(),
        getLatestPriceSnapshot: vi.fn(),
    },
}))

vi.mock('../services/reflector.js', () => ({
    ReflectorService: class {
        async getCurrentPrices() {
            return {}
        }
    },
}))

vi.mock('../services/serviceContainer.js', () => ({
    riskManagementService: {
        calculateRiskHeatmap: vi.fn(() => null),
    },
    rebalanceHistoryService: {},
}))

vi.mock('../services/stellar.js', () => ({
    StellarService: class {
        async getPortfolio() {
            return null
        }

        async createPortfolio() {
            return 'mock-portfolio-id'
        }
    },
}))

vi.mock('../queue/workers/workerRuntime.js', () => ({
    acquireWorkerLock: vi.fn(),
    releaseWorkerLock: vi.fn(),
    createWorkerRuntimeStatus: vi.fn(() => ({ isHealthy: true, status: 'idle' })),
}))

vi.mock('../api/analytics.routes.js', () => ({
    analyticsRouter: express.Router(),
}))

vi.mock('../utils/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}))

const mockedGetHistory = vi.mocked(databaseService.getRebalanceHistoryByDateRange)
const mockedGetSnapshot = vi.mocked(databaseService.getLatestPriceSnapshot)

function makeApp() {
    const app = express()
    app.use(express.json())
    app.use('/api', portfolioRouter)
    return app
}

describe('GET /api/portfolio/tax-report', () => {
    beforeEach(() => {
        mockedGetHistory.mockReset()
        mockedGetSnapshot.mockReset()
        mockedGetSnapshot.mockImplementation((asset: string) => ({
            asset,
            price: asset === 'XLM' ? 0.5 : asset === 'USDC' ? 1.0 : 0,
        }))
    })

    it('returns a FIFO tax report summary for the requested year', async () => {
        mockedGetHistory.mockReturnValue([
            {
                timestamp: '2025-03-01T00:00:00Z',
                details: { fromAsset: 'XLM', toAsset: 'USDC', amount: 1000 },
            },
        ])

        const res = await request(makeApp()).get('/api/portfolio/tax-report?year=2025')

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data.taxYear).toBe(2025)
        expect(res.body.data.totalTrades).toBe(2)
        expect(res.body.data.entries.length).toBe(2)
        expect(res.body.data.entries[0]).toMatchObject({ type: 'sell', asset: 'XLM' })
        expect(res.body.data.entries[1]).toMatchObject({ type: 'buy', asset: 'USDC' })
        expect(res.body.data.methodology).toContain('FIFO')
    })

    it('skips events without trade details', async () => {
        mockedGetHistory.mockReturnValue([
            { timestamp: '2025-03-01T00:00:00Z', details: {} },
            {
                timestamp: '2025-04-01T00:00:00Z',
                details: { fromAsset: 'XLM', toAsset: 'USDC', amount: 500 },
            },
        ])

        const res = await request(makeApp()).get('/api/portfolio/tax-report?year=2025')

        expect(res.status).toBe(200)
        expect(res.body.data.totalTrades).toBe(2)
    })

    it('defaults to the current tax year when year is omitted', async () => {
        mockedGetHistory.mockReturnValue([])

        const res = await request(makeApp()).get('/api/portfolio/tax-report')

        expect(res.status).toBe(200)
        expect(res.body.data.taxYear).toBe(new Date().getFullYear())
    })

    it('returns CSV with an attachment header when format=csv', async () => {
        mockedGetHistory.mockReturnValue([])

        const res = await request(makeApp()).get('/api/portfolio/tax-report?year=2025&format=csv')

        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toContain('text/csv')
        expect(res.headers['content-disposition']).toContain('sanctifier-tax-report-2025.csv')
        expect(res.text).toContain('realized_gain_loss')
    })

    it('rejects an out-of-range year', async () => {
        const res = await request(makeApp()).get('/api/portfolio/tax-report?year=1999')

        expect(res.status).toBe(400)
        expect(res.body.success).toBe(false)
    })
})
