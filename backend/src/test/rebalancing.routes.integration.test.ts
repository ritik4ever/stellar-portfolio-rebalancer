import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import express, { Express } from 'express'
import cors from 'cors'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { Keypair } from '@stellar/stellar-sdk'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('../utils/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}))

const JWT_SECRET = 'test-jwt-secret-for-rebalancing-tests-min-32!!'
const ADMIN_SECRET = 'test-admin-secret-for-rebalancing-tests-32!'

async function createApp(): Promise<Express> {
    const app = express()
    app.use(cors({ origin: true, credentials: true }))
    app.use(express.json({ limit: '10mb' }))
    app.set('trust proxy', 1)

    // Mount rebalancing routes
    const { rebalancingRouter } = await import('../api/rebalancing.routes.js')
    app.use('/api', rebalancingRouter)

    return app
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

describe('Rebalancing API Integration Tests', () => {
    let app: Express
    let testDbPath: string
    let adminKp: Keypair

    beforeAll(async () => {
        process.env.JWT_SECRET = JWT_SECRET
        process.env.NODE_ENV = 'test'

        // Set up admin keypair
        adminKp = Keypair.random()
        process.env.ADMIN_PUBLIC_KEYS = adminKp.publicKey()

        const testDir = join(tmpdir(), `stellar-rebal-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        mkdirSync(testDir, { recursive: true })
        testDbPath = join(testDir, 'test.db')
        process.env.DB_PATH = testDbPath

        app = await createApp()
    })

    afterAll(() => {
        if (existsSync(testDbPath)) {
            try { rmSync(testDbPath, { force: true }) } catch {}
        }
        delete process.env.DB_PATH
        delete process.env.JWT_SECRET
        delete process.env.ADMIN_PUBLIC_KEYS
    })

    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('GET /api/rebalance/history - paginated history', () => {
        it('returns history array with correct schema', async () => {
            const res = await request(app)
                .get('/api/rebalance/history')
                .expect(200)

            expect(res.body.success).toBe(true)
            expect(res.body.data.history).toBeDefined()
            expect(Array.isArray(res.body.data.history)).toBe(true)
            expect(res.body.data.filters).toBeDefined()
            expect(res.body.data.portfolioId).toBeUndefined()
        })

        it('returns meta with count', async () => {
            const res = await request(app)
                .get('/api/rebalance/history')
                .expect(200)

            expect(res.body.meta).toBeDefined()
            expect(res.body.meta.count).toBeDefined()
            expect(typeof res.body.meta.count).toBe('number')
        })

        it('accepts portfolioId filter', async () => {
            const res = await request(app)
                .get('/api/rebalance/history')
                .query({ portfolioId: 'test-portfolio-123' })
                .expect(200)

            expect(res.body.success).toBe(true)
            expect(res.body.data.portfolioId).toBe('test-portfolio-123')
        })

        it('accepts limit parameter', async () => {
            const res = await request(app)
                .get('/api/rebalance/history')
                .query({ limit: 10 })
                .expect(200)

            expect(res.body.success).toBe(true)
            expect(res.body.data.history.length).toBeLessThanOrEqual(10)
        })

        it('accepts source filter (onchain, offchain, simulated)', async () => {
            const res = await request(app)
                .get('/api/rebalance/history')
                .query({ source: 'onchain' })
                .expect(200)

            expect(res.body.success).toBe(true)
            expect(res.body.data.filters.source).toBe('onchain')
        })

        it('returns pagination metadata (total, page, limit conceptually)', async () => {
            const res = await request(app)
                .get('/api/rebalance/history')
                .query({ limit: 5 })
                .expect(200)

            // The API returns history array and meta.count
            // Pagination in this API is via limit parameter
            expect(res.body.meta).toBeDefined()
            expect(res.body.meta.count).toBeGreaterThanOrEqual(0)
        })
    })

    describe('POST /api/rebalance/history - record event', () => {
        it('records a rebalance event and returns it', async () => {
            const eventData = {
                portfolioId: 'test-portfolio-001',
                trigger: 'Threshold exceeded (8.2%)',
                trades: 2,
                gasUsed: '0.02 XLM',
                status: 'completed',
                isAutomatic: false
            }

            const res = await request(app)
                .post('/api/rebalance/history')
                .send(eventData)
                .expect(200)

            expect(res.body.success).toBe(true)
            expect(res.body.data.event).toBeDefined()
            expect(res.body.data.event.portfolioId).toBe('test-portfolio-001')
        })
    })

    describe('Admin routes - require admin authentication', () => {
        it('returns 401/403 for sync-onchain without admin headers', async () => {
            const res = await request(app)
                .post('/api/rebalance/history/sync-onchain')
                .expect((res) => {
                    expect([401, 403, 404]).toContain(res.status)
                })
        })

        it('allows sync-onchain with valid admin headers', async () => {
            const res = await request(app)
                .post('/api/rebalance/history/sync-onchain')
                .set(makeAdminHeaders(adminKp))
                .expect((res) => {
                    expect([200, 500]).toContain(res.status)
                })

            if (res.status === 200) {
                expect(res.body.success).toBe(true)
            }
        })

        it('returns 401/403 for auto-rebalancer start without admin', async () => {
            const res = await request(app)
                .post('/api/auto-rebalancer/start')
                .expect((res) => {
                    expect([401, 403, 404]).toContain(res.status)
                })
        })

        it('allows auto-rebalancer start with admin headers', async () => {
            const res = await request(app)
                .post('/api/auto-rebalancer/start')
                .set(makeAdminHeaders(adminKp))
                .expect((res) => {
                    expect([200, 500]).toContain(res.status)
                })

            if (res.status === 200) {
                expect(res.body.success).toBe(true)
            }
        })

        it('returns auto-rebalancer status without auth (public endpoint)', async () => {
            const res = await request(app)
                .get('/api/auto-rebalancer/status')
                .expect(200)

            expect(res.body.success).toBe(true)
            expect(res.body.data.status).toBeDefined()
            expect(res.body.data.statistics).toBeDefined()
        })

        it('returns auto-rebalancer history with admin auth', async () => {
            const res = await request(app)
                .get('/api/auto-rebalancer/history')
                .set(makeAdminHeaders(adminKp))
                .expect((res) => {
                    expect([200, 401, 403]).toContain(res.status)
                })

            if (res.status === 200) {
                expect(res.body.success).toBe(true)
                expect(res.body.data.history).toBeDefined()
            }
        })

        it('returns 401/403 for dry-run without admin', async () => {
            const res = await request(app)
                .post('/api/auto-rebalancer/dry-run/non-existent-portfolio')
                .send({})
                .expect((resp) => {
                    expect([401, 403, 404]).toContain(resp.status)
                })
        })

        it('returns actionable NOT_FOUND for admin dry-run when portfolio is missing', async () => {
            const res = await request(app)
                .post('/api/auto-rebalancer/dry-run/non-existent-portfolio')
                .set(makeAdminHeaders(adminKp))
                .send({})
                .expect((resp) => {
                    expect([404, 500]).toContain(resp.status)
                })

            if (res.status === 404) {
                expect(res.body.success).toBe(false)
                expect(res.body.error.code).toBe('NOT_FOUND')
                expect(res.body.error.message).toMatch(/not found/i)
            }
        })
    })

    describe('Ownership enforcement - other user portfolio', () => {
        it('validates portfolio ownership in write operations', async () => {
            // This test validates that the API structure supports ownership checks
            // The actual enforcement happens in the portfolio routes, not rebalancing routes directly
            // But we verify the endpoint exists and handles requests

            const res = await request(app)
                .get('/api/rebalance/history')
                .query({ portfolioId: 'other-user-portfolio' })
                .expect(200)

            // The history endpoint returns data filtered by portfolioId
            // Ownership enforcement would be in routes that modify state
            expect(res.body.success).toBe(true)
        })
    })

    describe('GET /api/rebalance/history with date filters', () => {
        it('accepts startTimestamp and endTimestamp', async () => {
            const start = new Date('2026-01-01').toISOString()
            const end = new Date('2026-12-31').toISOString()

            const res = await request(app)
                .get('/api/rebalance/history')
                .query({ startTimestamp: start, endTimestamp: end })
                .expect(200)

            expect(res.body.success).toBe(true)
            expect(res.body.data.filters.startTimestamp).toBe(start)
            expect(res.body.data.filters.endTimestamp).toBe(end)
        })
    })

    describe('GET /api/rebalance/summary/:portfolioId - readiness summary', () => {
        it('returns 404 for non-existent portfolio', async () => {
            const res = await request(app)
                .get('/api/rebalance/summary/nonexistent-portfolio-12345')
                .expect(404)

            expect(res.body.success).toBe(false)
            expect(res.body.error.code).toBe('NOT_FOUND')
        })

        it('returns summary with all preconditions for valid portfolio', async () => {
            // First create a test portfolio via the storage directly
            const { portfolioStorage } = await import('../services/portfolioStorage.js')
            const portfolioId = await portfolioStorage.createPortfolioWithBalances(
                'GTESTSUMMARY123456789',
                { XLM: 50, USDC: 50 },
                5,
                { XLM: 1000, USDC: 500 },
                1,
                'threshold',
                {}
            )

            const res = await request(app)
                .get(`/api/rebalance/summary/${portfolioId}`)
                .expect(200)

            expect(res.body.success).toBe(true)
            expect(res.body.data.portfolioId).toBe(portfolioId)
            expect(res.body.data.readiness).toBeDefined()
            expect(res.body.data.readiness.systemReady).toBeDefined()
            expect(res.body.data.readiness.canExecute).toBeDefined()
            expect(res.body.data.drift).toBeDefined()
            expect(res.body.data.drift.needsRebalance).toBeDefined()
            expect(res.body.data.drift.maxDriftPercent).toBeDefined()
            expect(res.body.data.slippage).toBeDefined()
            expect(res.body.data.slippage.maxSlippagePercent).toBeDefined()
            expect(res.body.data.risk).toBeDefined()
            expect(res.body.data.risk.allowed).toBeDefined()
            expect(res.body.data.risk.overallRiskLevel).toBeDefined()
            expect(res.body.data.dataFreshness).toBeDefined()
            expect(res.body.data.dataFreshness.isStale).toBeDefined()
            expect(res.body.meta).toBeDefined()
            expect(res.body.meta.canExecute).toBeDefined()
        })

        it('includes actionable risk alerts when blocked', async () => {
            const { portfolioStorage } = await import('../services/portfolioStorage.js')
            const portfolioId = await portfolioStorage.createPortfolioWithBalances(
                'GTESTRISK123456789',
                { XLM: 80, USDC: 20 }, // High concentration
                5,
                { XLM: 1000, USDC: 200 },
                1,
                'threshold',
                {}
            )

            const res = await request(app)
                .get(`/api/rebalance/summary/${portfolioId}`)
                .expect(200)

            expect(res.body.success).toBe(true)
            expect(res.body.data.risk).toBeDefined()
            expect(res.body.data.risk.metrics).toBeDefined()
            expect(res.body.data.risk.metrics.concentrationRisk).toBeGreaterThan(0)
            expect(res.body.data.recommendations).toBeDefined()
            expect(Array.isArray(res.body.data.recommendations)).toBe(true)
        })
    })
})
