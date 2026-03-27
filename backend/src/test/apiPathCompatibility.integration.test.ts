import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { Express } from 'express'
import request, { type Response as SupertestResponse } from 'supertest'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let app: Express
let testDbPath: string
const envBackup: NodeJS.ProcessEnv = { ...process.env }

beforeAll(async () => {
    const testDir = join(tmpdir(), `stellar-api-path-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    testDbPath = join(testDir, 'api-path.db')

    vi.resetModules()
    process.env = { ...envBackup }
    delete process.env.DATABASE_URL
    process.env.DB_PATH = testDbPath
    process.env.JWT_SECRET = 'unit-test-jwt-secret-min-32-chars!!'
    process.env.NODE_ENV = 'test'
    process.env.ENABLE_DEMO_DB_SEED = 'false'
    process.env.DEMO_MODE = 'true'
    process.env.RATE_LIMIT_CRITICAL_MAX = '100'
    process.env.RATE_LIMIT_WRITE_MAX = '100'
    process.env.RATE_LIMIT_WRITE_BURST_MAX = '200'
    process.env.RATE_LIMIT_BURST_MAX = '200'

    const express = (await import('express')).default
    const cors = (await import('cors')).default
    const { apiErrorHandler } = await import('../middleware/apiErrorHandler.js')
    const { mountApiRoutes, mountLegacyNonApiRedirects } = await import('../http/mountApiRoutes.js')

    app = express()
    app.use(
        cors({
            origin: true,
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
            allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With']
        })
    )
    app.use(express.json({ limit: '10mb' }))
    app.set('trust proxy', 1)
    mountLegacyNonApiRedirects(app)
    mountApiRoutes(app)
    app.use(apiErrorHandler)
}, 60_000)

afterAll(() => {
    process.env = { ...envBackup }
    if (existsSync(testDbPath)) {
        try {
            rmSync(testDbPath, { force: true })
        } catch {
            // ignore
        }
    }
})

/** Distinct 56-char Stellar-style addresses for portfolio tests. */
function demoPortfolioPayload(seed: string) {
    const tail = seed.replace(/\W/g, '').padEnd(12, '0').slice(0, 12)
    const userAddress = (`G${tail.padEnd(55, 'X')}`).slice(0, 56)
    return {
        userAddress,
        allocations: { XLM: 60, USDC: 40 },
        threshold: 5
    }
}

function expectNoDeprecationHeaders(res: SupertestResponse) {
    expect(res.headers.deprecation).toBeUndefined()
    expect(res.headers.sunset).toBeUndefined()
}

function expectLegacyDeprecationHeaders(res: SupertestResponse) {
    expect(res.headers.deprecation).toBe('true')
    expect(res.headers.sunset).toBeDefined()
    expect(String(res.headers.link)).toContain('deprecation')
}

describe('API path compatibility matrix', () => {
    it('GET /api/v1/strategies returns 200 envelope without deprecation headers (canonical)', async () => {
        const res = await request(app).get('/api/v1/strategies').expect(200)
        expect(res.headers.deprecation).toBeUndefined()
        expect(res.headers.sunset).toBeUndefined()
        expect(res.body.success).toBe(true)
        expect(res.body.data).toBeDefined()
        expect(res.body.error).toBeNull()
        expect(res.body.timestamp).toBeDefined()
        expect(Array.isArray(res.body.data.strategies)).toBe(true)
    })

    it('GET /api/strategies returns the same envelope with Deprecation / Sunset / Link (compatibility)', async () => {
        const res = await request(app).get('/api/strategies').expect(200)
        expect(res.headers.deprecation).toBe('true')
        expect(res.headers.sunset).toBeDefined()
        expect(String(res.headers.link)).toContain('deprecation')
        expect(res.body.success).toBe(true)
        expect(res.body.data).toBeDefined()
        expect(res.body.error).toBeNull()
        expect(Array.isArray(res.body.data.strategies)).toBe(true)
    })

    it('GET /api/v1/health returns JSON without deprecation headers', async () => {
        const res = await request(app).get('/api/v1/health').expect(200)
        expect(res.headers.deprecation).toBeUndefined()
        expect(res.body.status).toBe('healthy')
        expect(res.body.timestamp).toBeDefined()
    })

    it('GET /api/health returns the same JSON body with deprecation headers', async () => {
        const res = await request(app).get('/api/health').expect(200)
        expect(res.headers.deprecation).toBe('true')
        expect(res.body.status).toBe('healthy')
        expect(res.body.timestamp).toBeDefined()
    })

    it('validation errors use the standard envelope on both namespaces', async () => {
        const v1 = await request(app).get('/api/v1/consent/status').expect(400)
        expect(v1.headers.deprecation).toBeUndefined()
        expect(v1.body.success).toBe(false)
        expect(v1.body.data).toBeNull()
        expect(v1.body.error?.code).toBe('VALIDATION_ERROR')

        const legacy = await request(app).get('/api/consent/status').expect(400)
        expect(legacy.headers.deprecation).toBe('true')
        expect(legacy.body.success).toBe(false)
        expect(legacy.body.error?.code).toBe('VALIDATION_ERROR')
    })

    it('GET /rebalance/history redirects to canonical /api/v1/rebalance/history preserving query string', async () => {
        const res = await request(app).get('/rebalance/history').query({ limit: '3', portfolioId: 'p1' }).expect(308)
        const loc = res.headers.location
        expect(loc).toBeDefined()
        const u = new URL(loc!, 'http://localhost')
        expect(u.pathname).toBe('/api/v1/rebalance/history')
        expect(u.searchParams.get('limit')).toBe('3')
        expect(u.searchParams.get('portfolioId')).toBe('p1')
    })

    it('GET /api/auth/login is not marked as deprecated (auth mounted outside compatibility prefix)', async () => {
        const res = await request(app).post('/api/auth/login').send({}).expect(400)
        expect(res.headers.deprecation).toBeUndefined()
    })

    it('POST /portfolio: canonical and legacy return the same envelope and semantics for the same payload shape', async () => {
        const payload = demoPortfolioPayload('create-parity-aaa')
        const v1 = await request(app).post('/api/v1/portfolio').send(payload).expect(201)
        const legacy = await request(app).post('/api/portfolio').send(demoPortfolioPayload('create-parity-bbb')).expect(201)

        expectNoDeprecationHeaders(v1)
        expectLegacyDeprecationHeaders(legacy)

        for (const res of [v1, legacy]) {
            expect(res.body.success).toBe(true)
            expect(res.body.error).toBeNull()
            expect(res.body.timestamp).toBeDefined()
            expect(typeof res.body.data.portfolioId).toBe('string')
            expect(res.body.data.status).toBe('created')
            expect(res.body.data.mode).toBe('demo')
        }
    })

    it(
        'GET /portfolio/:id: same portfolio body from /api/v1 and legacy /api',
        async () => {
            const payload = demoPortfolioPayload('detail-parity-ccc')
            const created = await request(app).post('/api/v1/portfolio').send(payload).expect(201)
            const portfolioId = created.body.data.portfolioId as string

            const v1 = await request(app).get(`/api/v1/portfolio/${portfolioId}`).expect(200)
            const legacy = await request(app).get(`/api/portfolio/${portfolioId}`).expect(200)

            expectNoDeprecationHeaders(v1)
            expectLegacyDeprecationHeaders(legacy)
            const p1 = v1.body.data.portfolio
            const p2 = legacy.body.data.portfolio
            expect(p1.id).toBe(p2.id)
            expect(p1.userAddress).toBe(p2.userAddress)
            expect(p1.threshold).toBe(p2.threshold)
            expect(p1.slippageTolerancePercent).toBe(p2.slippageTolerancePercent)
        },
        30_000
    )

    it('GET /auto-rebalancer/status: same shape and stable fields; legacy includes deprecation headers', async () => {
        const v1 = await request(app).get('/api/v1/auto-rebalancer/status').expect(200)
        const legacy = await request(app).get('/api/auto-rebalancer/status').expect(200)

        expectNoDeprecationHeaders(v1)
        expectLegacyDeprecationHeaders(legacy)
        expect(v1.body.data.status).toEqual(legacy.body.data.status)
        expect(v1.body.data.statistics).toMatchObject({
            averageRebalancesPerDay: legacy.body.data.statistics.averageRebalancesPerDay,
            rebalancesToday: legacy.body.data.statistics.rebalancesToday,
            totalAutoRebalances: legacy.body.data.statistics.totalAutoRebalances
        })
        expect(typeof v1.body.data.statistics.lastCheckTime).toBe('string')
        expect(typeof legacy.body.data.statistics.lastCheckTime).toBe('string')
    })

    it('notifications GET preferences: JWT auth parity (canonical vs legacy resource roots)', async () => {
        const address = 'GNOTIFY123456789ABCDEF0000001'
        const login = await request(app).post('/api/auth/login').send({ address }).expect(200)
        expectNoDeprecationHeaders(login)
        const token = login.body.data.accessToken as string

        const v1 = await request(app)
            .get('/api/v1/notifications/preferences')
            .query({ userId: address })
            .set('Authorization', `Bearer ${token}`)
            .expect(200)
        const legacy = await request(app)
            .get('/api/notifications/preferences')
            .query({ userId: address })
            .set('Authorization', `Bearer ${token}`)
            .expect(200)

        expectNoDeprecationHeaders(v1)
        expectLegacyDeprecationHeaders(legacy)
        expect(v1.body.data).toEqual(legacy.body.data)
    })

    it('notifications POST subscribe: validation errors match on canonical and legacy (with JWT)', async () => {
        const address = 'GSUBSCRIBE123456789ABCDEF00001'
        const login = await request(app).post('/api/auth/login').send({ address }).expect(200)
        const token = login.body.data.accessToken as string
        const invalidBody = { userId: address }

        const v1 = await request(app)
            .post('/api/v1/notifications/subscribe')
            .set('Authorization', `Bearer ${token}`)
            .send(invalidBody)
            .expect(400)
        const legacy = await request(app)
            .post('/api/notifications/subscribe')
            .set('Authorization', `Bearer ${token}`)
            .send(invalidBody)
            .expect(400)

        expectNoDeprecationHeaders(v1)
        expectLegacyDeprecationHeaders(legacy)
        expect(v1.body.success).toBe(false)
        expect(legacy.body.success).toBe(false)
        expect(v1.body.error?.code).toBe('VALIDATION_ERROR')
        expect(legacy.body.error?.code).toBe('VALIDATION_ERROR')
    })

    it('auth stays under /api/auth only: versioned auth URL is not served', async () => {
        await request(app).post('/api/v1/auth/login').send({ address: 'GTEST0000000000000000000001' }).expect(404)
    })

    it('POST /api/auth/refresh and /api/auth/login are never marked deprecated', async () => {
        const loginRes = await request(app).post('/api/auth/login').send({ address: 'GREFRESH0000000000000000001' }).expect(200)
        expectNoDeprecationHeaders(loginRes)

        const refreshMissing = await request(app).post('/api/auth/refresh').send({}).expect(400)
        expectNoDeprecationHeaders(refreshMissing)
    })
})
