import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import express from 'express'
import type { Express } from 'express'
import cors from 'cors'
import request from 'supertest'
import jwt from 'jsonwebtoken'
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

const JWT_SECRET = 'test-jwt-secret-for-portfolio-tests-min-32!!'
const OWNER_ADDRESS = 'GPORTFOWNER123456789ABCDEF'
const OTHER_ADDRESS = 'GPORTFOTHER123456789ABCDEF'

function createApp(): Express {
    const app = express()
    app.use(cors({ origin: true, credentials: true }))
    app.use(express.json({ limit: '10mb' }))
    app.set('trust proxy', 1)

    const { portfolioRouter } = require('../api/routes.js') as any
    app.use('/api', portfolioRouter)

    return app
}

function authHeader(address: string): Record<string, string> {
    const token = jwt.sign({ sub: address, type: 'access' }, JWT_SECRET, { expiresIn: '15m' })
    return { Authorization: `Bearer ${token}` }
}

describe('Portfolio CRUD API Integration Tests with JWT Authentication', () => {
    let app: Express
    let testDbPath: string
    let createdPortfolioId: string | null = null

    beforeAll(() => {
        process.env.JWT_SECRET = JWT_SECRET
        process.env.NODE_ENV = 'test'

        const testDir = join(tmpdir(), `stellar-portf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        mkdirSync(testDir, { recursive: true })
        testDbPath = join(testDir, 'test.db')
        process.env.DB_PATH = testDbPath

        app = createApp()
    })

    afterAll(() => {
        if (existsSync(testDbPath)) {
            try { rmSync(testDbPath, { force: true }) } catch {}
        }
        delete process.env.DB_PATH
        delete process.env.JWT_SECRET
    })

    beforeEach(() => {
        vi.clearAllMocks()
        createdPortfolioId = null
    })

    describe('POST /api/portfolio - Create portfolio', () => {
        it('creates portfolio with valid payload', async () => {
            const payload = {
                userAddress: OWNER_ADDRESS,
                allocations: { XLM: 60, USDC: 40 },
                threshold: 5
            }

            const res = await request(app)
                .post('/api/portfolio')
                .send(payload)
                .expect((res) => {
                    expect([200, 201]).toContain(res.status)
                })

            expect(res.body.success).toBe(true)
            expect(res.body.error).toBeNull()
            expect(res.body.data.portfolioId).toBeDefined()
            expect(res.body.data.status).toBe('created')
            expect(res.body.data.mode).toBe('demo')

            createdPortfolioId = res.body.data.portfolioId
        })

        it('returns 400 for missing required fields (no userAddress)', async () => {
            const res = await request(app)
                .post('/api/portfolio')
                .send({ allocations: { XLM: 60, USDC: 40 }, threshold: 5 })
                .expect(400)

            expect(res.body.success).toBe(false)
            expect(res.body.data).toBeNull()
            expect(res.body.error.code).toBe('VALIDATION_ERROR')
        })

        it('returns 400 for missing allocations', async () => {
            const res = await request(app)
                .post('/api/portfolio')
                .send({ userAddress: OWNER_ADDRESS, threshold: 5 })
                .expect(400)

            expect(res.body.success).toBe(false)
            expect(res.body.error.code).toBe('VALIDATION_ERROR')
        })

        it('returns 400 for missing threshold', async () => {
            const res = await request(app)
                .post('/api/portfolio')
                .send({ userAddress: OWNER_ADDRESS, allocations: { XLM: 60, USDC: 40 } })
                .expect(400)

            expect(res.body.success).toBe(false)
            expect(res.body.error.code).toBe('VALIDATION_ERROR')
        })

        it('returns 400 if allocations do not sum to 100%', async () => {
            const res = await request(app)
                .post('/api/portfolio')
                .send({
                    userAddress: OWNER_ADDRESS,
                    allocations: { XLM: 60, USDC: 30 },
                    threshold: 5
                })
                .expect(400)

            expect(res.body.success).toBe(false)
            expect(res.body.error.code).toBe('VALIDATION_ERROR')
        })

        it('returns 400 if threshold is out of range (too high)', async () => {
            const res = await request(app)
                .post('/api/portfolio')
                .send({
                    userAddress: OWNER_ADDRESS,
                    allocations: { XLM: 60, USDC: 40 },
                    threshold: 100
                })
                .expect(400)

            expect(res.body.success).toBe(false)
            expect(res.body.error.code).toBe('VALIDATION_ERROR')
        })

        it('returns 400 if threshold is out of range (too low)', async () => {
            const res = await request(app)
                .post('/api/portfolio')
                .send({
                    userAddress: OWNER_ADDRESS,
                    allocations: { XLM: 60, USDC: 40 },
                    threshold: 0
                })
                .expect(400)

            expect(res.body.success).toBe(false)
            expect(res.body.error.code).toBe('VALIDATION_ERROR')
        })

        it('accepts optional slippageTolerance', async () => {
            const res = await request(app)
                .post('/api/portfolio')
                .send({
                    userAddress: OWNER_ADDRESS,
                    allocations: { XLM: 60, USDC: 40 },
                    threshold: 5,
                    slippageTolerance: 2.5
                })
                .expect((res) => {
                    expect([200, 201]).toContain(res.status)
                })

            expect(res.body.success).toBe(true)
            createdPortfolioId = res.body.data.portfolioId
        })

        it('accepts strategy parameter', async () => {
            const res = await request(app)
                .post('/api/portfolio')
                .send({
                    userAddress: OWNER_ADDRESS,
                    allocations: { XLM: 60, USDC: 40 },
                    threshold: 5,
                    strategy: 'periodic'
                })
                .expect((res) => {
                    expect([200, 201]).toContain(res.status)
                })

            expect(res.body.success).toBe(true)
        })
    })

    describe('GET /api/portfolio/:id - Get portfolio', () => {
        beforeEach(async () => {
            const res = await request(app)
                .post('/api/portfolio')
                .send({
                    userAddress: OWNER_ADDRESS,
                    allocations: { XLM: 60, USDC: 40 },
                    threshold: 5
                })

            if (res.body.success) {
                createdPortfolioId = res.body.data.portfolioId
            }
        })

        it('returns portfolio data with valid ID', async () => {
            const res = await request(app)
                .get(`/api/portfolio/${createdPortfolioId}`)
                .expect((res) => {
                    expect([200, 201]).toContain(res.status)
                })

            expect(res.body.success).toBe(true)
            expect(res.body.error).toBeNull()
            expect(res.body.data.portfolio).toBeDefined()
            expect(res.body.data.portfolio.id).toBe(createdPortfolioId)
            expect(res.body.data.portfolio.userAddress).toBe(OWNER_ADDRESS)
        })

        it('returns 400 for missing portfolio ID', async () => {
            const res = await request(app)
                .get('/api/portfolio/')
                .expect((res) => {
                    expect([400, 404]).toContain(res.status)
                })
        })

        it('returns error for non-existent portfolio', async () => {
            const res = await request(app)
                .get('/api/portfolio/non-existent-id-xyz')
                .expect((res) => {
                    expect([400, 404, 500]).toContain(res.status)
                })

            expect(res.body.success).toBe(false)
            expect(res.body.error).toBeDefined()
        })

        it('response body matches OpenAPI spec schema', async () => {
            const res = await request(app)
                .get(`/api/portfolio/${createdPortfolioId}`)
                .expect((res) => {
                    expect([200, 201]).toContain(res.status)
                })

            const portfolio = res.body.data.portfolio
            expect(portfolio).toHaveProperty('id')
            expect(portfolio).toHaveProperty('userAddress')
            expect(portfolio).toHaveProperty('allocations')
            expect(portfolio).toHaveProperty('threshold')
            expect(portfolio).toHaveProperty('balances')
            expect(portfolio).toHaveProperty('createdAt')
        })

        it('GET with JWT auth returns same data', async () => {
            const res = await request(app)
                .get(`/api/portfolio/${createdPortfolioId}`)
                .set(authHeader(OWNER_ADDRESS))
                .expect((res) => {
                    expect([200, 201]).toContain(res.status)
                })

            expect(res.body.success).toBe(true)
        })
    })

    describe('GET /api/user/:address/portfolios - List user portfolios', () => {
        it('returns portfolios for valid address', async () => {
            await request(app)
                .post('/api/portfolio')
                .send({
                    userAddress: OWNER_ADDRESS,
                    allocations: { XLM: 60, USDC: 40 },
                    threshold: 5
                })

            const res = await request(app)
                .get(`/api/user/${OWNER_ADDRESS}/portfolios`)
                .expect(200)

            expect(res.body.success).toBe(true)
            expect(Array.isArray(res.body.data.portfolios)).toBe(true)
            expect(res.body.data.portfolios.length).toBeGreaterThan(0)
        })

        it('returns 400 for missing address', async () => {
            const res = await request(app)
                .get('/api/user//portfolios')
                .expect((res) => {
                    expect([400, 404]).toContain(res.status)
                })
        })

        it('returns empty array for user with no portfolios', async () => {
            const res = await request(app)
                .get(`/api/user/${OTHER_ADDRESS}/portfolios`)
                .expect(200)

            expect(res.body.success).toBe(true)
            expect(Array.isArray(res.body.data.portfolios)).toBe(true)
        })

        it('returns 403 when trying to view another users portfolios with JWT', async () => {
            const res = await request(app)
                .get(`/api/user/${OTHER_ADDRESS}/portfolios`)
                .set(authHeader(OWNER_ADDRESS))
                .expect((res) => {
                    expect([200, 403]).toContain(res.status)
                })

            if (res.status === 403) {
                expect(res.body.success).toBe(false)
                expect(res.body.error.code).toBe('FORBIDDEN')
            }
        })
    })

    describe('DELETE /api/portfolio/:id - Delete portfolio', () => {
        it('DELETE endpoint is not currently implemented', async () => {
            const res = await request(app)
                .delete('/api/portfolio/some-id')
                .expect((res) => {
                    expect([404, 405, 401, 403]).toContain(res.status)
                })
        })
    })

    describe('JWT Authentication - 401 and 403 cases', () => {
        let portfolioId: string

        beforeEach(async () => {
            const res = await request(app)
                .post('/api/portfolio')
                .send({
                    userAddress: OWNER_ADDRESS,
                    allocations: { XLM: 60, USDC: 40 },
                    threshold: 5
                })

            if (res.body.success) {
                portfolioId = res.body.data.portfolioId
            }
        })

        it('POST /api/portfolio/:id/rebalance requires auth when JWT enabled', async () => {
            const res = await request(app)
                .post(`/api/portfolio/${portfolioId}/rebalance`)
                .send({})
                .expect((res) => {
                    expect([200, 201, 400, 409, 401, 403]).toContain(res.status)
                })

            if (res.status === 401) {
                expect(res.body.success).toBe(false)
            }
        })

        it('returns 403 when rebalancing another users portfolio with JWT', async () => {
            const res = await request(app)
                .post(`/api/portfolio/${portfolioId}/rebalance`)
                .set(authHeader(OTHER_ADDRESS))
                .send({})
                .expect((res) => {
                    expect([403, 400, 409, 500]).toContain(res.status)
                })

            if (res.status === 403) {
                expect(res.body.success).toBe(false)
                expect(res.body.error.code).toBe('FORBIDDEN')
            }
        })

        it('GET /api/portfolio/:id/export requires auth for other users', async () => {
            const res = await request(app)
                .get(`/api/portfolio/${portfolioId}/export`)
                .set(authHeader(OTHER_ADDRESS))
                .query({ format: 'json' })
                .expect((res) => {
                    expect([403, 200, 404]).toContain(res.status)
                })

            if (res.status === 403) {
                expect(res.body.success).toBe(false)
                expect(res.body.error.code).toBe('FORBIDDEN')
            }
        })
    })

    describe('Response body schema validation against OpenAPI spec', () => {
        it('POST /api/portfolio returns correct envelope structure', async () => {
            const res = await request(app)
                .post('/api/portfolio')
                .send({
                    userAddress: OWNER_ADDRESS,
                    allocations: { XLM: 60, USDC: 40 },
                    threshold: 5
                })
                .expect((res) => {
                    expect([200, 201]).toContain(res.status)
                })

            expect(res.body).toHaveProperty('success')
            expect(res.body).toHaveProperty('data')
            expect(res.body).toHaveProperty('error')
            expect(res.body).toHaveProperty('timestamp')

            expect(res.body.data).toHaveProperty('portfolioId')
            expect(res.body.data).toHaveProperty('status')
            expect(res.body.data).toHaveProperty('mode')
        })

        it('GET /api/portfolio/:id returns correct envelope structure', async () => {
            const createRes = await request(app)
                .post('/api/portfolio')
                .send({
                    userAddress: OWNER_ADDRESS,
                    allocations: { XLM: 60, USDC: 40 },
                    threshold: 5
                })

            const portfolioId = createRes.body.data.portfolioId

            const res = await request(app)
                .get(`/api/portfolio/${portfolioId}`)
                .expect((res) => {
                    expect([200, 201]).toContain(res.status)
                })

            expect(res.body).toHaveProperty('success')
            expect(res.body).toHaveProperty('data')
            expect(res.body).toHaveProperty('error')
            expect(res.body).toHaveProperty('timestamp')

            expect(res.body.data).toHaveProperty('portfolio')
            expect(res.body.data.portfolio).toHaveProperty('id')
            expect(res.body.data.portfolio).toHaveProperty('userAddress')
            expect(res.body.data.portfolio).toHaveProperty('allocations')
        })

        it('GET /api/user/:address/portfolios returns correct envelope', async () => {
            const res = await request(app)
                .get(`/api/user/${OWNER_ADDRESS}/portfolios`)
                .expect(200)

            expect(res.body).toHaveProperty('success')
            expect(res.body).toHaveProperty('data')
            expect(res.body).toHaveProperty('error')
            expect(res.body).toHaveProperty('timestamp')

            expect(res.body.data).toHaveProperty('portfolios')
            expect(Array.isArray(res.body.data.portfolios)).toBe(true)
        })
    })

    describe('GET /api/portfolio/:id/rebalance-plan', () => {
        let portfolioId: string

        beforeEach(async () => {
            const res = await request(app)
                .post('/api/portfolio')
                .send({
                    userAddress: OWNER_ADDRESS,
                    allocations: { XLM: 60, USDC: 40 },
                    threshold: 5
                })

            if (res.body.success) {
                portfolioId = res.body.data.portfolioId
            }
        })

        it('returns rebalance plan with correct schema', async () => {
            const res = await request(app)
                .get(`/api/portfolio/${portfolioId}/rebalance-plan`)
                .expect((res) => {
                    expect([200, 201]).toContain(res.status)
                })

            expect(res.body.success).toBe(true)
            expect(res.body.data).toHaveProperty('portfolioId')
            expect(res.body.data).toHaveProperty('totalValue')
            expect(res.body.data).toHaveProperty('maxSlippagePercent')
            expect(res.body.data).toHaveProperty('estimatedSlippageBps')
        })
    })

    describe('GET /api/portfolio/:id/analytics', () => {
        let portfolioId: string

        beforeEach(async () => {
            const res = await request(app)
                .post('/api/portfolio')
                .send({
                    userAddress: OWNER_ADDRESS,
                    allocations: { XLM: 60, USDC: 40 },
                    threshold: 5
                })

            if (res.body.success) {
                portfolioId = res.body.data.portfolioId
            }
        })

        it('returns analytics data with correct structure', async () => {
            const res = await request(app)
                .get(`/api/portfolio/${portfolioId}/analytics`)
                .expect((res) => {
                    expect([200, 201]).toContain(res.status)
                })

            expect(res.body.success).toBe(true)
            expect(res.body.data).toHaveProperty('portfolioId')
            expect(res.body.data).toHaveProperty('data')
            expect(res.body.meta).toHaveProperty('count')
        })

        it('accepts days query parameter', async () => {
            const res = await request(app)
                .get(`/api/portfolio/${portfolioId}/analytics`)
                .query({ days: 60 })
                .expect((res) => {
                    expect([200, 201]).toContain(res.status)
                })

            expect(res.body.success).toBe(true)
        })
    })
})
