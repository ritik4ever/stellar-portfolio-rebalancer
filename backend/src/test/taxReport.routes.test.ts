/**
 * Integration tests for GET /api/portfolio/tax-report
 *
 * Verifies cost-basis method selection (FIFO/LIFO/HIFO), CSV output,
 * the TurboTax export format, and year validation for the mounted taxReportRouter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { portfolioRouter } from '../api/routes.js'
import { databaseService } from '../services/databaseService.js'
import { TURBOTAX_HEADERS } from '../api/taxReport.routes.js'

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
        getPriceSnapshotAsOf: vi.fn(),
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
const mockedGetSnapshotAsOf = vi.mocked((databaseService as any).getPriceSnapshotAsOf)

function makeApp() {
    const app = express()
    app.use(express.json())
    app.use('/api', portfolioRouter)
    return app
}

/**
 * Shared sample history used by the cost-basis method tests.
 *
 * XLM is acquired in three lots at rising prices (0.40, 0.60, 0.50) by selling
 * USDC, then 1000 XLM is sold back into USDC at 0.55. Which lots that final sale
 * consumes — and therefore the realized gain — depends on the method:
 *
 *   FIFO → the 0.40 lot (cheapest, acquired first)  → largest gain
 *   LIFO → the 0.50 lot (acquired last)             → middle gain
 *   HIFO → the 0.60 lot (highest cost)              → smallest gain (a loss)
 */
const XLM_PRICES_BY_DATE: Record<string, number> = {
    '2025-01-01T00:00:00Z': 0.4,
    '2025-02-01T00:00:00Z': 0.6,
    '2025-03-01T00:00:00Z': 0.5,
    '2025-06-01T00:00:00Z': 0.55,
}

const SAMPLE_HISTORY = [
    // Buy 1000 XLM @ 0.40 (400 USDC)
    { timestamp: '2025-01-01T00:00:00Z', details: { fromAsset: 'USDC', toAsset: 'XLM', amount: 400 } },
    // Buy 1000 XLM @ 0.60 (600 USDC)
    { timestamp: '2025-02-01T00:00:00Z', details: { fromAsset: 'USDC', toAsset: 'XLM', amount: 600 } },
    // Buy 1000 XLM @ 0.50 (500 USDC)
    { timestamp: '2025-03-01T00:00:00Z', details: { fromAsset: 'USDC', toAsset: 'XLM', amount: 500 } },
    // Sell 1000 XLM @ 0.55 → 550 USDC proceeds
    { timestamp: '2025-06-01T00:00:00Z', details: { fromAsset: 'XLM', toAsset: 'USDC', amount: 1000 } },
]

/** Realized gain on the XLM disposals only (the USDC sells have zero-basis noise). */
function xlmRealizedGain(body: any): number {
    return body.data.disposals
        .filter((d: any) => d.asset === 'XLM')
        .reduce((sum: number, d: any) => sum + d.realizedGainLoss, 0)
}

describe('GET /api/portfolio/tax-report', () => {
    beforeEach(() => {
        mockedGetHistory.mockReset()
        mockedGetSnapshot.mockReset()
        mockedGetSnapshotAsOf.mockReset()
        mockedGetSnapshot.mockImplementation((asset: string) => ({
            asset,
            price: asset === 'XLM' ? 0.5 : asset === 'USDC' ? 1.0 : 0,
            capturedAt: '2025-01-01T00:00:00Z',
        }))
        mockedGetSnapshotAsOf.mockImplementation((asset: string, asOf: string) => {
            if (asset === 'USDC') return { price: 1.0, capturedAt: asOf }
            if (asset === 'XLM' && XLM_PRICES_BY_DATE[asOf] !== undefined) {
                return { price: XLM_PRICES_BY_DATE[asOf], capturedAt: asOf }
            }
            return undefined
        })
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
        expect(res.body.data.costBasisMethod).toBe('fifo')
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

    describe('cost-basis method selection', () => {
        beforeEach(() => {
            mockedGetHistory.mockReturnValue([...SAMPLE_HISTORY])
        })

        it('defaults to FIFO when costBasisMethod is omitted', async () => {
            const explicit = await request(makeApp()).get(
                '/api/portfolio/tax-report?year=2025&costBasisMethod=fifo',
            )
            const implicit = await request(makeApp()).get('/api/portfolio/tax-report?year=2025')

            expect(implicit.status).toBe(200)
            expect(implicit.body.data.costBasisMethod).toBe('fifo')
            expect(implicit.body.data.totalRealizedGainLoss).toBeCloseTo(
                explicit.body.data.totalRealizedGainLoss,
                6,
            )
        })

        it('matches the oldest lot under FIFO', async () => {
            const res = await request(makeApp()).get(
                '/api/portfolio/tax-report?year=2025&costBasisMethod=fifo',
            )

            expect(res.status).toBe(200)
            const xlmDisposals = res.body.data.disposals.filter((d: any) => d.asset === 'XLM')
            expect(xlmDisposals).toHaveLength(1)
            expect(xlmDisposals[0].acquiredDate).toBe('2025-01-01T00:00:00Z')
            // proceeds 1000 × 0.55 = 550, basis 1000 × 0.40 = 400 → +150
            expect(xlmRealizedGain(res.body)).toBeCloseTo(150, 6)
        })

        it('matches the newest lot under LIFO', async () => {
            const res = await request(makeApp()).get(
                '/api/portfolio/tax-report?year=2025&costBasisMethod=lifo',
            )

            expect(res.status).toBe(200)
            expect(res.body.data.costBasisMethod).toBe('lifo')
            expect(res.body.data.methodology).toContain('LIFO')
            const xlmDisposals = res.body.data.disposals.filter((d: any) => d.asset === 'XLM')
            expect(xlmDisposals[0].acquiredDate).toBe('2025-03-01T00:00:00Z')
            // basis 1000 × 0.50 = 500 → +50
            expect(xlmRealizedGain(res.body)).toBeCloseTo(50, 6)
        })

        it('matches the highest-cost lot under HIFO', async () => {
            const res = await request(makeApp()).get(
                '/api/portfolio/tax-report?year=2025&costBasisMethod=hifo',
            )

            expect(res.status).toBe(200)
            expect(res.body.data.costBasisMethod).toBe('hifo')
            expect(res.body.data.methodology).toContain('HIFO')
            const xlmDisposals = res.body.data.disposals.filter((d: any) => d.asset === 'XLM')
            expect(xlmDisposals[0].acquiredDate).toBe('2025-02-01T00:00:00Z')
            // basis 1000 × 0.60 = 600 → −50
            expect(xlmRealizedGain(res.body)).toBeCloseTo(-50, 6)
        })

        it('produces three distinct gain figures across the same trade history', async () => {
            const [fifo, lifo, hifo] = await Promise.all(
                ['fifo', 'lifo', 'hifo'].map(m =>
                    request(makeApp()).get(`/api/portfolio/tax-report?year=2025&costBasisMethod=${m}`),
                ),
            )

            const gains = [fifo, lifo, hifo].map(r => xlmRealizedGain(r.body))
            expect(new Set(gains).size).toBe(3)
            // HIFO minimises gains, FIFO maximises them on a rising-then-falling basis set
            expect(gains[0]).toBeGreaterThan(gains[1])
            expect(gains[1]).toBeGreaterThan(gains[2])
        })

        it('is case-insensitive for the method name', async () => {
            const res = await request(makeApp()).get(
                '/api/portfolio/tax-report?year=2025&costBasisMethod=HIFO',
            )

            expect(res.status).toBe(200)
            expect(res.body.data.costBasisMethod).toBe('hifo')
        })

        it('rejects an unknown cost-basis method', async () => {
            const res = await request(makeApp()).get(
                '/api/portfolio/tax-report?year=2025&costBasisMethod=average',
            )

            expect(res.status).toBe(400)
            expect(res.body.success).toBe(false)
            expect(res.body.error.message).toContain('costBasisMethod')
        })

        it('splits a sell across multiple lots when one lot is not enough', async () => {
            mockedGetHistory.mockReturnValue([
                ...SAMPLE_HISTORY.slice(0, 3),
                {
                    timestamp: '2025-06-01T00:00:00Z',
                    details: { fromAsset: 'XLM', toAsset: 'USDC', amount: 1500 },
                },
            ])

            const res = await request(makeApp()).get(
                '/api/portfolio/tax-report?year=2025&costBasisMethod=fifo',
            )

            const xlmDisposals = res.body.data.disposals.filter((d: any) => d.asset === 'XLM')
            expect(xlmDisposals).toHaveLength(2)
            expect(xlmDisposals[0]).toMatchObject({ acquiredDate: '2025-01-01T00:00:00Z', amount: 1000 })
            expect(xlmDisposals[1]).toMatchObject({ acquiredDate: '2025-02-01T00:00:00Z', amount: 500 })
        })
    })

    describe('TurboTax CSV export', () => {
        beforeEach(() => {
            mockedGetHistory.mockReturnValue([...SAMPLE_HISTORY])
        })

        it('exports the documented TurboTax column schema', async () => {
            const res = await request(makeApp()).get(
                '/api/portfolio/tax-report?year=2025&format=turbotax',
            )

            expect(res.status).toBe(200)
            expect(res.headers['content-type']).toContain('text/csv')
            expect(res.headers['content-disposition']).toContain('turbotax-tax-report-2025-fifo.csv')

            const [header] = res.text.split('\n')
            expect(header).toBe('Currency Name,Purchase Date,Cost Basis,Date Sold,Proceeds')
            expect(header.split(',')).toEqual([...TURBOTAX_HEADERS])
        })

        it('emits one row per disposed lot with MM/DD/YYYY dates and 2-decimal amounts', async () => {
            const res = await request(makeApp()).get(
                '/api/portfolio/tax-report?year=2025&format=turbotax&costBasisMethod=fifo',
            )

            const rows = res.text.split('\n').slice(1).filter(Boolean)
            const xlmRow = rows.find(r => r.startsWith('XLM,'))

            expect(xlmRow).toBeDefined()
            // XLM lot acquired 01/01/2025 @ 0.40 (400.00) sold 06/01/2025 for 550.00
            expect(xlmRow).toBe('XLM,01/01/2025,400.00,06/01/2025,550.00')
            rows.forEach(row => expect(row.split(',')).toHaveLength(TURBOTAX_HEADERS.length))
        })

        it('honours the selected cost-basis method in the TurboTax export', async () => {
            const res = await request(makeApp()).get(
                '/api/portfolio/tax-report?year=2025&format=turbotax&costBasisMethod=hifo',
            )

            expect(res.headers['content-disposition']).toContain('turbotax-tax-report-2025-hifo.csv')
            const xlmRow = res.text.split('\n').find(r => r.startsWith('XLM,'))
            // HIFO consumes the 0.60 lot acquired 02/01/2025 (basis 600.00)
            expect(xlmRow).toBe('XLM,02/01/2025,600.00,06/01/2025,550.00')
        })

        it('returns a header-only CSV when there are no disposals', async () => {
            mockedGetHistory.mockReturnValue([])

            const res = await request(makeApp()).get(
                '/api/portfolio/tax-report?year=2025&format=turbotax',
            )

            expect(res.status).toBe(200)
            expect(res.text).toBe(TURBOTAX_HEADERS.join(','))
        })
    })
})
