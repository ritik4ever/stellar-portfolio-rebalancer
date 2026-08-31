import { describe, it, expect, vi, beforeEach } from 'vitest'
import express, { Express } from 'express'
import request from 'supertest'

// Mock logger
vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

// Mock portfolioStorage
const mockGetPortfolio = vi.fn()
vi.mock('../services/portfolioStorage.js', () => ({
    portfolioStorage: {
        getPortfolio: (...args: unknown[]) => mockGetPortfolio(...args),
    }
}))

// Mock dbGetPortfolioRebalanceHistory (transitive import of the router)
const mockDbGetPortfolioRebalanceHistory = vi.fn()
vi.mock('../db/rebalanceHistoryDb.js', () => ({
    dbGetPortfolioRebalanceHistory: (...args: unknown[]) => mockDbGetPortfolioRebalanceHistory(...args),
}))

// Mock service container: export path delegates to rebalanceHistoryService
const mockGetRebalanceHistoryForExport = vi.fn()
vi.mock('../services/serviceContainer.js', () => ({
    rebalanceHistoryService: {
        getRebalanceHistory: vi.fn().mockResolvedValue([]),
        getRebalanceHistoryForExport: (...args: unknown[]) => mockGetRebalanceHistoryForExport(...args),
    },
    riskManagementService: { shouldAllowRebalance: vi.fn().mockReturnValue({ allowed: true }) }
}))

// Mock other transitive deps used by the router
vi.mock('../services/stellar.js', () => ({ StellarService: class { constructor() {} } }))
vi.mock('../services/reflector.js', () => ({ ReflectorService: class { constructor() {} } }))
vi.mock('../services/databaseService.js', () => ({ databaseService: {} }))
vi.mock('../config/featureFlags.js', () => ({ getFeatureFlags: () => ({}) }))
vi.mock('../services/authService.js', () => ({ getAuthConfig: () => ({ enabled: false }) }))
vi.mock('../middleware/idempotency.js', () => ({ idempotencyMiddleware: (_req: any, _res: any, next: any) => next() }))
vi.mock('../middleware/requireJwt.js', () => ({
    requireJwt: (_req: any, _res: any, next: any) => next(),
    requireJwtWhenEnabled: (_req: any, _res: any, next: any) => next()
}))
vi.mock('../middleware/rateLimit.js', () => ({
    protectedWriteLimiter: [(_req: any, _res: any, next: any) => next()]
}))
vi.mock('../queue/workers/workerRuntime.js', () => ({
    acquireWorkerLock: vi.fn().mockResolvedValue(true),
    releaseWorkerLock: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('./analytics.routes.js', () => ({
    analyticsRouter: express.Router()
}))

let app: Express

beforeEach(async () => {
    vi.clearAllMocks()
    const { portfoliosRouter } = await import('../api/portfolios.routes.js')
    app = express()
    app.use(express.json())
    app.use('/api', portfoliosRouter)
})

describe('GET /api/portfolio/:id/rebalance-history/export', () => {
    const PORTFOLIO_ID = 'test-portfolio-123'
    const MOCK_PORTFOLIO = { id: PORTFOLIO_ID, userAddress: 'GTEST', allocations: { XLM: 50, USDC: 50 }, threshold: 5 }

    const HISTORY_EVENT = {
        id: 'evt-1',
        portfolioId: PORTFOLIO_ID,
        timestamp: '2026-06-01T00:00:00.000Z',
        trigger: 'Automatic scheduled',
        trades: 2,
        gasUsed: '0.00042',
        status: 'completed',
        isAutomatic: true,
        eventSource: 'offchain',
        onChainTxHash: 'abc123',
        feePaid: 0.42,
        slippageBps: 12,
        details: {
            fromAsset: 'XLM',
            toAsset: 'USDC',
            amount: 5000,
            gasFeeXlm: 0.42,
            gasFeeUsd: 0.04,
            gasBreakdown: [
                { tradeId: 't1', fromAsset: 'XLM', toAsset: 'USDC', feeXlm: 0.42 },
            ],
        },
    }

    it('returns 404 when portfolio does not exist', async () => {
        mockGetPortfolio.mockResolvedValue(null)

        const res = await request(app)
            .get(`/api/portfolio/${PORTFOLIO_ID}/rebalance-history/export`)
            .expect(404)

        expect(res.body.error.code).toBe('NOT_FOUND')
    })

    it('exports JSON by default (application/json) with history and fee fields', async () => {
        mockGetPortfolio.mockResolvedValue(MOCK_PORTFOLIO)
        mockGetRebalanceHistoryForExport.mockResolvedValue([HISTORY_EVENT])

        const res = await request(app)
            .get(`/api/portfolio/${PORTFOLIO_ID}/rebalance-history/export`)
            .expect(200)

        expect(res.headers['content-type']).toContain('application/json')
        expect(res.headers['content-disposition']).toContain('rebalance-history')

        const body = JSON.parse(res.text)
        expect(body.portfolioId).toBe(PORTFOLIO_ID)
        expect(body.meta.format).toBe('json')
        expect(body.count).toBe(1)
        expect(body.history).toHaveLength(1)
        expect(body.history[0]).toEqual(expect.objectContaining({
            id: 'evt-1',
            feePaid: 0.42,
            slippageBps: 12,
            timestamp: '2026-06-01T00:00:00.000Z',
        }))
        expect(body.history[0].details.gasBreakdown).toHaveLength(1)
    })

    it('exports CSV when format=csv with fee and trade-leg columns', async () => {
        mockGetPortfolio.mockResolvedValue(MOCK_PORTFOLIO)
        mockGetRebalanceHistoryForExport.mockResolvedValue([HISTORY_EVENT])

        const res = await request(app)
            .get(`/api/portfolio/${PORTFOLIO_ID}/rebalance-history/export`)
            .query({ format: 'csv' })
            .expect(200)

        expect(res.headers['content-type']).toContain('text/csv')

        const line = res.text.split('\n')[0]
        expect(line).toContain('tradeLegs')
        expect(line).toContain('feePaid')
        expect(line).toContain('gasFeeXlm')

        expect(res.text).toContain('evt-1')
        expect(res.text).toContain('XLM')
        expect(res.text).toContain('USDC')
    })

    it('passes from/to date range filters through to the service', async () => {
        mockGetPortfolio.mockResolvedValue(MOCK_PORTFOLIO)
        mockGetRebalanceHistoryForExport.mockResolvedValue([])

        await request(app)
            .get(`/api/portfolio/${PORTFOLIO_ID}/rebalance-history/export`)
            .query({ format: 'csv', from: '2026-01-01T00:00:00Z', to: '2026-06-01T00:00:00Z' })
            .expect(200)

        expect(mockGetRebalanceHistoryForExport).toHaveBeenCalledWith(
            PORTFOLIO_ID,
            { from: '2026-01-01T00:00:00Z', to: '2026-06-01T00:00:00Z' }
        )
    })

    it('rejects an unsupported format with 422', async () => {
        mockGetPortfolio.mockResolvedValue(MOCK_PORTFOLIO)

        const res = await request(app)
            .get(`/api/portfolio/${PORTFOLIO_ID}/rebalance-history/export`)
            .query({ format: 'pdf' })
            .expect(422)

        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
        expect(mockGetRebalanceHistoryForExport).not.toHaveBeenCalled()
    })
})