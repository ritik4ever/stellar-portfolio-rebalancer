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

// Mock dbGetPortfolioRebalanceHistory
const mockDbGetPortfolioRebalanceHistory = vi.fn()
vi.mock('../db/rebalanceHistoryDb.js', () => ({
    dbGetPortfolioRebalanceHistory: (...args: unknown[]) => mockDbGetPortfolioRebalanceHistory(...args),
}))

// Mock service container (needed by portfolios router transitive deps)
vi.mock('../services/serviceContainer.js', () => ({
    rebalanceHistoryService: { getRebalanceHistory: vi.fn().mockResolvedValue([]) },
    riskManagementService: { shouldAllowRebalance: vi.fn().mockReturnValue({ allowed: true }) }
}))

// Mock other transitive deps used by the router
vi.mock('../services/stellar.js', () => ({ StellarService: class { constructor() {} } }))
vi.mock('../services/reflector.js', () => ({ ReflectorService: class { constructor() {} } }))
vi.mock('../services/databaseService.js', () => ({ databaseService: {} }))
vi.mock('../config/featureFlags.js', () => ({ getFeatureFlags: () => ({}) }))
vi.mock('../services/authService.js', () => ({ getAuthConfig: () => ({ enabled: false }) }))
vi.mock('../services/portfolioExportService.js', () => ({ getPortfolioExport: vi.fn() }))
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

describe('GET /api/portfolio/:id/rebalance-history', () => {
    const PORTFOLIO_ID = 'test-portfolio-123'
    const MOCK_PORTFOLIO = { id: PORTFOLIO_ID, userAddress: 'GTEST', allocations: { XLM: 50, USDC: 50 }, threshold: 5 }

    it('returns 404 when portfolio does not exist', async () => {
        mockGetPortfolio.mockResolvedValue(null)

        const res = await request(app)
            .get(`/api/portfolio/${PORTFOLIO_ID}/rebalance-history`)
            .expect(404)

        expect(res.body.error.code).toBe('NOT_FOUND')
    })

    it('returns paginated history with default params', async () => {
        mockGetPortfolio.mockResolvedValue(MOCK_PORTFOLIO)
        mockDbGetPortfolioRebalanceHistory.mockResolvedValue({
            items: [
                {
                    id: 'evt-1',
                    portfolioId: PORTFOLIO_ID,
                    timestamp: '2026-06-01T00:00:00.000Z',
                    trigger: 'Manual rebalance',
                    triggerType: 'manual',
                    assetsTrades: 2,
                    totalFeeXlm: 0.5,
                    totalFeeUsd: 0.05,
                    totalSlippageBps: 12,
                    status: 'success',
                    errorReason: null,
                }
            ],
            total: 1,
        })

        const res = await request(app)
            .get(`/api/portfolio/${PORTFOLIO_ID}/rebalance-history`)
            .expect(200)

        expect(res.body.data.history).toHaveLength(1)
        expect(res.body.data.history[0]).toEqual(expect.objectContaining({
            id: 'evt-1',
            status: 'success',
            triggerType: 'manual',
            assetsTrades: 2,
            totalSlippageBps: 12,
        }))
        expect(res.body.data.pagination).toEqual({
            page: 1,
            pageSize: 50,
            total: 1,
            totalPages: 1
        })

        // Verify DB was called with correct defaults
        expect(mockDbGetPortfolioRebalanceHistory).toHaveBeenCalledWith(PORTFOLIO_ID, expect.objectContaining({
            limit: 50,
            offset: 0,
            sort: 'desc'
        }))
    })

    it('passes filter params to DB layer', async () => {
        mockGetPortfolio.mockResolvedValue(MOCK_PORTFOLIO)
        mockDbGetPortfolioRebalanceHistory.mockResolvedValue({ items: [], total: 0 })

        const res = await request(app)
            .get(`/api/portfolio/${PORTFOLIO_ID}/rebalance-history`)
            .query({
                from: '2026-01-01T00:00:00Z',
                to: '2026-06-01T00:00:00Z',
                trigger_type: 'auto',
                status: 'failed',
                page: 2,
                page_size: 10,
                sort: 'asc'
            })
            .expect(200)

        expect(mockDbGetPortfolioRebalanceHistory).toHaveBeenCalledWith(PORTFOLIO_ID, {
            from: '2026-01-01T00:00:00Z',
            to: '2026-06-01T00:00:00Z',
            trigger_type: 'auto',
            status: 'failed',
            limit: 10,
            offset: 10,
            sort: 'asc'
        })

        expect(res.body.data.pagination.page).toBe(2)
        expect(res.body.data.pagination.pageSize).toBe(10)
        expect(res.body.data.filters).toEqual({
            from: '2026-01-01T00:00:00Z',
            to: '2026-06-01T00:00:00Z',
            trigger_type: 'auto',
            status: 'failed'
        })
    })

    it('includes failed rebalances with error reason', async () => {
        mockGetPortfolio.mockResolvedValue(MOCK_PORTFOLIO)
        mockDbGetPortfolioRebalanceHistory.mockResolvedValue({
            items: [
                {
                    id: 'evt-fail-1',
                    portfolioId: PORTFOLIO_ID,
                    timestamp: '2026-05-20T10:00:00.000Z',
                    trigger: 'Automatic scheduled',
                    triggerType: 'auto',
                    assetsTrades: 0,
                    totalFeeXlm: null,
                    totalFeeUsd: null,
                    totalSlippageBps: null,
                    status: 'failed',
                    errorReason: 'Insufficient liquidity on DEX',
                }
            ],
            total: 1,
        })

        const res = await request(app)
            .get(`/api/portfolio/${PORTFOLIO_ID}/rebalance-history`)
            .query({ status: 'failed' })
            .expect(200)

        expect(res.body.data.history[0].status).toBe('failed')
        expect(res.body.data.history[0].errorReason).toBe('Insufficient liquidity on DEX')
    })

    it('returns correct totalPages for pagination', async () => {
        mockGetPortfolio.mockResolvedValue(MOCK_PORTFOLIO)
        mockDbGetPortfolioRebalanceHistory.mockResolvedValue({ items: [], total: 250 })

        const res = await request(app)
            .get(`/api/portfolio/${PORTFOLIO_ID}/rebalance-history`)
            .query({ page_size: 100 })
            .expect(200)

        expect(res.body.data.pagination.totalPages).toBe(3)
        expect(res.body.data.pagination.total).toBe(250)
    })
})
