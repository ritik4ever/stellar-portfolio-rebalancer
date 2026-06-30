import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import express, { type Express } from 'express'
import cors from 'cors'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { Keypair } from '@stellar/stellar-sdk'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const JWT_SECRET = 'test-jwt-secret-dry-run-routes-min-32-chars!!'
const OWNER_ADDRESS = 'GDRYRUNOWNER123456789ABCDEF'
const PORTFOLIO_ID = 'portfolio-dry-run-1'

const mockDryRunResult = {
    portfolioId: PORTFOLIO_ID,
    timestamp: '2026-06-01T12:00:00.000Z',
    canExecute: true,
    overallStatus: 'ready' as const,
    trigger: 'Threshold exceeded (8.2%)',
    estimatedTrades: [
        {
            tradeId: 'trade-1',
            fromAsset: 'XLM',
            toAsset: 'USDC',
            requestedAmount: 100,
            estimatedReceivedAmount: 18.5,
            referencePrice: 0.185,
            priceLimit: 0.183,
            spreadBps: 54,
            slippageBps: 100,
            liquidityCoverage: 10,
            status: 'executable' as const,
        },
    ],
    skippedTrades: [] as unknown[],
    skippedAssets: [] as unknown[],
    guardrails: {
        riskManagement: { allowed: true, reason: 'Risk checks passed' },
        cooldown: { allowed: true, reason: 'Cooldown satisfied' },
        marketConditions: { allowed: true, reason: 'Market conditions are safe' },
        rebalanceRequired: { allowed: true, reason: 'Portfolio drift exceeds rebalance strategy threshold' },
    },
    feeEstimate: { totalFeeXlm: 0.00001, totalFeeUsd: 0.0000035, xlmPriceUsd: 0.35 },
    estimatedTotalSlippageBps: 100,
}

const { mockDryRunRebalance, mockExecuteRebalance, mockGetPortfolio } = vi.hoisted(() => ({
    mockDryRunRebalance: vi.fn(),
    mockExecuteRebalance: vi.fn(),
    mockGetPortfolio: vi.fn(),
}))

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../services/reflector.js', () => {
    function ReflectorService(this: unknown) {
        (this as { getCurrentPrices: ReturnType<typeof vi.fn> }).getCurrentPrices = vi.fn().mockResolvedValue({})
    }
    return { ReflectorService }
})

vi.mock('../services/stellar.js', () => {
    function StellarService(this: unknown) {
        const self = this as {
            dryRunRebalance: typeof mockDryRunRebalance
            executeRebalance: typeof mockExecuteRebalance
            getPortfolio: typeof mockGetPortfolio
        }
        self.dryRunRebalance = mockDryRunRebalance
        self.executeRebalance = mockExecuteRebalance
        self.getPortfolio = mockGetPortfolio
    }
    return { StellarService }
})

vi.mock('../services/serviceContainer.js', () => ({
    rebalanceHistoryService: {
        recordRebalanceEvent: vi.fn(),
    },
    riskManagementService: {
        shouldAllowRebalance: vi.fn().mockReturnValue({ allowed: true, reason: 'OK', alerts: [] }),
    },
}))

function authHeader(address: string): Record<string, string> {
    const token = jwt.sign({ sub: address, type: 'access' }, JWT_SECRET, { expiresIn: '15m' })
    return { Authorization: `Bearer ${token}` }
}

function makeAdminHeaders(kp: Keypair) {
    const msg = Date.now().toString()
    const sig = kp.sign(Buffer.from(msg, 'utf8')).toString('base64')
    return {
        'x-public-key': kp.publicKey(),
        'x-message': msg,
        'x-signature': sig,
    }
}

function assertDryRunPayload(result: Record<string, unknown>) {
    expect(result.portfolioId).toBe(PORTFOLIO_ID)
    expect(result).toHaveProperty('estimatedTrades')
    expect(result).toHaveProperty('skippedAssets')
    expect(result).toHaveProperty('guardrails')
    expect(result.guardrails).toMatchObject({
        riskManagement: expect.objectContaining({ allowed: expect.any(Boolean), reason: expect.any(String) }),
        cooldown: expect.objectContaining({ allowed: expect.any(Boolean), reason: expect.any(String) }),
        marketConditions: expect.objectContaining({ allowed: expect.any(Boolean), reason: expect.any(String) }),
        rebalanceRequired: expect.objectContaining({ allowed: expect.any(Boolean), reason: expect.any(String) }),
    })
}

describe('Rebalance dry-run API (#435)', () => {
    describe('POST /api/portfolio/:id/rebalance/dry-run', () => {
        let app: Express
        let testDbPath: string

        beforeAll(async () => {
            process.env.JWT_SECRET = JWT_SECRET
            process.env.NODE_ENV = 'test'

            const testDir = join(tmpdir(), `stellar-dryrun-pf-${Date.now()}`)
            mkdirSync(testDir, { recursive: true })
            testDbPath = join(testDir, 'test.db')
            process.env.DB_PATH = testDbPath

            const appInstance = express()
            appInstance.use(cors({ origin: true, credentials: true }))
            appInstance.use(express.json())
            const { portfoliosRouter } = await import('../api/portfolios.routes.js')
            appInstance.use('/api', portfoliosRouter)
            app = appInstance
        })

        afterAll(() => {
            if (existsSync(testDbPath)) {
                try { rmSync(testDbPath, { force: true }) } catch { /* ignore */ }
            }
            delete process.env.DB_PATH
            delete process.env.JWT_SECRET
        })

        beforeEach(() => {
            vi.clearAllMocks()
            mockDryRunRebalance.mockResolvedValue(mockDryRunResult)
            mockGetPortfolio.mockResolvedValue({
                id: PORTFOLIO_ID,
                userAddress: OWNER_ADDRESS,
                allocations: { XLM: 60, USDC: 40 },
                threshold: 5,
            })
        })

        it('returns estimated trades, skipped assets, and guardrails without writing history', async () => {
            const { rebalanceHistoryService } = await import('../services/serviceContainer.js')

            const res = await request(app)
                .post(`/api/portfolio/${PORTFOLIO_ID}/rebalance/dry-run`)
                .set(authHeader(OWNER_ADDRESS))
                .send({ options: { slippageOverrides: { 'XLM->USDC': 120 } } })
                .expect(200)

            expect(res.body.success).toBe(true)
            assertDryRunPayload(res.body.data.result)
            expect(mockDryRunRebalance).toHaveBeenCalledWith(
                PORTFOLIO_ID,
                expect.objectContaining({ tradeSlippageOverrides: { 'XLM->USDC': 120 } }),
            )
            expect(mockExecuteRebalance).not.toHaveBeenCalled()
            expect(rebalanceHistoryService.recordRebalanceEvent).not.toHaveBeenCalled()
        })

        it('returns 404 with actionable error when portfolio is missing', async () => {
            mockGetPortfolio.mockResolvedValue(null)

            const res = await request(app)
                .post(`/api/portfolio/${PORTFOLIO_ID}/rebalance/dry-run`)
                .set(authHeader(OWNER_ADDRESS))
                .send({})
                .expect(404)

            expect(res.body.success).toBe(false)
            expect(res.body.error.code).toBe('NOT_FOUND')
            expect(mockDryRunRebalance).not.toHaveBeenCalled()
        })

        it('returns 403 when JWT subject does not own the portfolio', async () => {
            const res = await request(app)
                .post(`/api/portfolio/${PORTFOLIO_ID}/rebalance/dry-run`)
                .set(authHeader('GOTHERUSER123456789ABCDEF'))
                .send({})
                .expect(403)

            expect(res.body.error.code).toBe('FORBIDDEN')
            expect(mockDryRunRebalance).not.toHaveBeenCalled()
        })
    })

    describe('POST /api/auto-rebalancer/dry-run/:portfolioId', () => {
        let app: Express
        let testDbPath: string
        let adminKp: Keypair

        beforeAll(async () => {
            process.env.NODE_ENV = 'test'
            adminKp = Keypair.random()
            process.env.ADMIN_PUBLIC_KEYS = adminKp.publicKey()

            const testDir = join(tmpdir(), `stellar-dryrun-ar-${Date.now()}`)
            mkdirSync(testDir, { recursive: true })
            testDbPath = join(testDir, 'test.db')
            process.env.DB_PATH = testDbPath

            const appInstance = express()
            appInstance.use(cors({ origin: true, credentials: true }))
            appInstance.use(express.json())
            const { rebalancingRouter } = await import('../api/rebalancing.routes.js')
            appInstance.use('/api', rebalancingRouter)
            app = appInstance
        })

        afterAll(() => {
            if (existsSync(testDbPath)) {
                try { rmSync(testDbPath, { force: true }) } catch { /* ignore */ }
            }
            delete process.env.DB_PATH
            delete process.env.ADMIN_PUBLIC_KEYS
        })

        beforeEach(() => {
            vi.clearAllMocks()
            mockDryRunRebalance.mockResolvedValue(mockDryRunResult)
        })

        it('returns dry-run preview for admin via auto-rebalancer code path', async () => {
            const res = await request(app)
                .post(`/api/auto-rebalancer/dry-run/${PORTFOLIO_ID}`)
                .set(makeAdminHeaders(adminKp))
                .send({})
                .expect(200)

            expect(res.body.success).toBe(true)
            assertDryRunPayload(res.body.data.result)
            expect(mockDryRunRebalance).toHaveBeenCalledWith(PORTFOLIO_ID, {})
            expect(mockExecuteRebalance).not.toHaveBeenCalled()
        })

        it('returns 401/403 without admin authentication', async () => {
            await request(app)
                .post(`/api/auto-rebalancer/dry-run/${PORTFOLIO_ID}`)
                .send({})
                .expect((resp) => {
                    expect([401, 403]).toContain(resp.status)
                })

            expect(mockDryRunRebalance).not.toHaveBeenCalled()
        })

        it('returns 404 when portfolio is not found', async () => {
            mockDryRunRebalance.mockRejectedValue(new Error('Portfolio not found'))

            const res = await request(app)
                .post(`/api/auto-rebalancer/dry-run/${PORTFOLIO_ID}`)
                .set(makeAdminHeaders(adminKp))
                .send({})
                .expect(404)

            expect(res.body.error.code).toBe('NOT_FOUND')
        })
    })
})
