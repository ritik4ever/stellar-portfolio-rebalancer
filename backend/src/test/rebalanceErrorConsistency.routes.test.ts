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

// Mock rebalanceHistoryService and riskManagementService
const mockRecordRebalanceEvent = vi.fn()
const mockGetRebalanceHistory = vi.fn()
const mockShouldAllowRebalance = vi.fn()

vi.mock('../services/serviceContainer.js', () => ({
    rebalanceHistoryService: {
        recordRebalanceEvent: (...args: unknown[]) => mockRecordRebalanceEvent(...args),
        getRebalanceHistory: (...args: unknown[]) => mockGetRebalanceHistory(...args),
    },
    riskManagementService: {
        shouldAllowRebalance: (...args: unknown[]) => mockShouldAllowRebalance(...args),
    }
}))

// Mock stellarService
const mockExecuteRebalance = vi.fn()
const mockStellarGetPortfolio = vi.fn()
vi.mock('../services/stellar.js', () => ({
    StellarService: class {
        executeRebalance(...args: unknown[]) {
            return mockExecuteRebalance(...args)
        }
        getPortfolio(...args: unknown[]) {
            return mockStellarGetPortfolio(...args)
        }
    }
}))

// Mock reflector
vi.mock('../services/reflector.js', () => ({
    ReflectorService: class {
        getCurrentPrices() {
            return Promise.resolve({ XLM: 0.12, USDC: 1.0 })
        }
    }
}))

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
    applyRateLimit: () => (_req: any, _res: any, next: any) => next(),
    protectedWriteLimiter: [(_req: any, _res: any, next: any) => next()]
}))

const mockAcquireWorkerLock = vi.fn()
const mockReleaseWorkerLock = vi.fn()
vi.mock('../queue/workers/workerRuntime.js', () => ({
    acquireWorkerLock: (...args: unknown[]) => mockAcquireWorkerLock(...args),
    releaseWorkerLock: (...args: unknown[]) => mockReleaseWorkerLock(...args)
}))
vi.mock('./analytics.routes.js', () => ({
    analyticsRouter: express.Router()
}))

let app: Express

beforeEach(async () => {
    vi.clearAllMocks()
    mockAcquireWorkerLock.mockResolvedValue(true)
    mockReleaseWorkerLock.mockResolvedValue(undefined)
    mockShouldAllowRebalance.mockReturnValue({ allowed: true })

    const { portfoliosRouter } = await import('../api/portfolios.routes.js')
    app = express()
    app.use(express.json())
    app.use('/api', portfoliosRouter)
})

describe('SPR-2026-188: State consistency in API error serialization', () => {
    const PORTFOLIO_ID = 'test-portfolio-188'
    const MOCK_PORTFOLIO = {
        id: PORTFOLIO_ID,
        userAddress: 'GTEST188',
        allocations: { XLM: 60, USDC: 40 },
        threshold: 5
    }

    it('persists failed status and error details when rebalance returns failed status', async () => {
        mockStellarGetPortfolio.mockResolvedValue(MOCK_PORTFOLIO)
        mockExecuteRebalance.mockResolvedValue({
            status: 'failed',
            failureReason: 'Slippage limit exceeded for XLM/USDC pair',
            trades: 0,
            gasUsed: '0.001 XLM',
            explanation: {
                failureReason: 'Slippage limit exceeded for XLM/USDC pair',
                rationale: 'Market depth insufficient',
            }
        })
        mockRecordRebalanceEvent.mockResolvedValue({ id: 'evt-failed-1' })

        const res = await request(app)
            .post(`/api/portfolio/${PORTFOLIO_ID}/rebalance`)
            .send({})
            .expect(200)

        expect(res.body.success).toBe(true)
        expect(res.body.data.result.status).toBe('failed')
        expect(res.body.data.result.failureReason).toBe('Slippage limit exceeded for XLM/USDC pair')

        // Persisted event must agree with the execution result
        expect(mockRecordRebalanceEvent).toHaveBeenCalledWith(expect.objectContaining({
            portfolioId: PORTFOLIO_ID,
            status: 'failed',
            error: 'Slippage limit exceeded for XLM/USDC pair',
            details: expect.objectContaining({
                failureReason: 'Slippage limit exceeded for XLM/USDC pair'
            })
        }))
    })

    it('persists failure record and returns sanitized error code without internal details on thrown error', async () => {
        mockStellarGetPortfolio.mockResolvedValue(MOCK_PORTFOLIO)
        // Simulate interrupted work / internal database or RPC failure with sensitive details
        mockExecuteRebalance.mockRejectedValue(new Error('FATAL: password authentication failed for user "secret_db_admin"'))
        mockRecordRebalanceEvent.mockResolvedValue({ id: 'evt-failed-2' })

        const res = await request(app)
            .post(`/api/portfolio/${PORTFOLIO_ID}/rebalance`)
            .send({})
            .expect(500)

        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('INTERNAL_ERROR')
        expect(res.body.error.message).toBe('Rebalance execution failed')
        // Must NOT leak internal credentials or stack traces
        expect(res.body.error.message).not.toContain('password')
        expect(res.body.error.message).not.toContain('secret_db_admin')

        // State consistency: failure record was persisted in database so history matches outcome
        expect(mockRecordRebalanceEvent).toHaveBeenCalledWith(expect.objectContaining({
            portfolioId: PORTFOLIO_ID,
            status: 'failed',
            trigger: 'Manual Rebalancing (Failed)',
            error: 'Rebalance execution failed due to an unexpected error',
            details: expect.objectContaining({
                source: 'api',
                outcome: 'failed',
                failureReason: 'Rebalance execution failed due to an unexpected error',
                diagnosticContext: expect.stringContaining('FATAL: password authentication failed'),
            })
        }))
        const callArgs = mockRecordRebalanceEvent.mock.calls[0][0]
        expect(callArgs.details.diagnosticContext).not.toContain('secret_db_admin')
        expect(callArgs.details.diagnosticContext).toContain('[REDACTED]')
        expect(mockReleaseWorkerLock).toHaveBeenCalledWith(PORTFOLIO_ID)
    })

    it('returns consistent CONFLICT code without leaking internal lock details during concurrent work', async () => {
        mockAcquireWorkerLock.mockResolvedValue(false)

        const res = await request(app)
            .post(`/api/portfolio/${PORTFOLIO_ID}/rebalance`)
            .send({})
            .expect(409)

        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('CONFLICT')
        expect(res.body.error.message).toBe('Rebalance already in progress for this portfolio')
        expect(mockExecuteRebalance).not.toHaveBeenCalled()
    })

    it('returns sanitized error response when fetching rebalance history fails', async () => {
        mockGetPortfolio.mockResolvedValue(MOCK_PORTFOLIO)
        mockDbGetPortfolioRebalanceHistory.mockRejectedValue(new Error('Connection terminated unexpectedly: postgres://admin:pass@db:5432'))

        const res = await request(app)
            .get(`/api/portfolio/${PORTFOLIO_ID}/rebalance-history`)
            .expect(500)

        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('INTERNAL_ERROR')
        expect(res.body.error.message).toBe('Failed to fetch rebalance history')
        expect(res.body.error.message).not.toContain('postgres://')
    })
})
