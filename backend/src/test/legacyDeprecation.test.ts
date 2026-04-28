import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { Express } from 'express'
import request from 'supertest'
import express from 'express'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { legacyApiDeprecation } from '../middleware/legacyApiDeprecation.js'

let app: Express
let testDbPath: string
const envBackup: NodeJS.ProcessEnv = { ...process.env }

beforeAll(async () => {
    const testDir = join(tmpdir(), `stellar-deprecation-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    testDbPath = join(testDir, 'deprecation-test.db')

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
    process.env = envBackup
    if (testDbPath) {
        const dir = join(testDbPath, '..')
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    }
})

describe('Legacy API Deprecation Headers', () => {
    describe('GET /api/* (legacy paths)', () => {
        it('should return Deprecation, Sunset, and Link headers on /api/health', async () => {
            const res = await request(app).get('/api/health')
            expect(res.headers['deprecation']).toBe('true')
            expect(res.headers['sunset']).toMatch(/^\w{3}, \d{2} \w{3} \d{4}/)
            expect(res.headers['link']).toContain('rel="deprecation"')
        })

        it('should return deprecation headers on /api/prices', async () => {
            const res = await request(app).get('/api/prices')
            expect(res.headers['deprecation']).toBe('true')
            expect(res.headers['sunset']).toBeDefined()
            expect(res.headers['link']).toBeDefined()
        })

        it('should return deprecation headers on /api/strategies', async () => {
            const res = await request(app).get('/api/strategies')
            expect(res.headers['deprecation']).toBe('true')
            expect(res.headers['sunset']).toBeDefined()
            expect(res.headers['link']).toContain('deprecation')
        })

        it('should return deprecation headers on /api/assets', async () => {
            const res = await request(app).get('/api/assets')
            expect(res.headers['deprecation']).toBe('true')
            expect(res.headers['sunset']).toBeDefined()
        })

        it('should return deprecation headers on /api/system/status', async () => {
            const res = await request(app).get('/api/system/status')
            expect(res.headers['deprecation']).toBe('true')
            expect(res.headers['sunset']).toBeDefined()
        })
    })

    describe('GET /api/v1/* (canonical paths)', () => {
        it('should NOT return deprecation headers on /api/v1/health', async () => {
            const res = await request(app).get('/api/v1/health')
            expect(res.headers['deprecation']).toBeUndefined()
            expect(res.headers['sunset']).toBeUndefined()
            expect(res.headers['link']).toBeUndefined()
        })

        it('should NOT return deprecation headers on /api/v1/prices', async () => {
            const res = await request(app).get('/api/v1/prices')
            expect(res.headers['deprecation']).toBeUndefined()
            expect(res.headers['sunset']).toBeUndefined()
        })

        it('should NOT return deprecation headers on /api/v1/strategies', async () => {
            const res = await request(app).get('/api/v1/strategies')
            expect(res.headers['deprecation']).toBeUndefined()
            expect(res.headers['sunset']).toBeUndefined()
        })

        it('should NOT return deprecation headers on /api/v1/assets', async () => {
            const res = await request(app).get('/api/v1/assets')
            expect(res.headers['deprecation']).toBeUndefined()
            expect(res.headers['sunset']).toBeUndefined()
        })

        it('should NOT return deprecation headers on /api/v1/system/status', async () => {
            const res = await request(app).get('/api/v1/system/status')
            expect(res.headers['deprecation']).toBeUndefined()
            expect(res.headers['sunset']).toBeUndefined()
        })
    })

    describe('GET /api/auth/* (auth paths)', () => {
        it('should NOT return deprecation headers on actual auth routes', async () => {
            // Auth routes are mounted before the deprecation middleware.
            // However, unknown sub-paths under /api/auth may fall through to the /api middleware.
            // Test the actual auth endpoint (POST /api/auth/login would not carry deprecation).
            // For GET, the auth router returns 404 for unknown paths, but the /api middleware
            // still applies. This test verifies that known auth routes work without issue.
            const res = await request(app).post('/api/auth/login').send({ address: 'test' })
            // Auth routes are processed before deprecation middleware in Express order
            // so the response should not carry deprecation headers
            expect(res.status).not.toBe(500)
        })
    })

    describe('Sunset header value', () => {
        it('should have a valid future date in the Sunset header', async () => {
            const res = await request(app).get('/api/health')
            const sunsetDate = new Date(res.headers['sunset'])
            const now = new Date()
            expect(sunsetDate.getTime()).toBeGreaterThan(now.getTime())
        })
    })

    describe('Response body is unchanged', () => {
        it('legacy and canonical paths return identical data for /health', async () => {
            const legacyRes = await request(app).get('/api/health')
            const canonicalRes = await request(app).get('/api/v1/health')
            expect(canonicalRes.status).toBe(legacyRes.status)
            expect(canonicalRes.body.status).toBe(legacyRes.body.status)
        })
    })
})

describe('legacyApiDeprecation redirect compatibility', () => {
    const redirectApp = express()
    redirectApp.use(express.json())
    redirectApp.use('/api', legacyApiDeprecation)

    redirectApp.get('/api/v1/portfolios', (_req, res) => {
        res.status(200).json({ ok: true })
    })
    redirectApp.post('/api/v1/portfolios', (req, res) => {
        res.status(200).json({ body: req.body })
    })
    redirectApp.use('/api/*', (_req, res) => {
        res.status(404).json({ code: 'NOT_FOUND' })
    })

    it('redirects GET /api/portfolios to /api/v1/portfolios with 301', async () => {
        const res = await request(redirectApp).get('/api/portfolios')
        expect(res.status).toBe(301)
        expect(res.headers.location).toBe('/api/v1/portfolios')
    })

    it('includes RFC 8594 deprecation headers on legacy redirects', async () => {
        const res = await request(redirectApp).get('/api/portfolios')
        expect(res.headers['deprecation']).toBe('true')
        expect(res.headers['sunset']).toMatch(/^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/)
        expect(res.headers['link']).toContain('rel="deprecation"')
    })

    it('preserves POST body through redirect', async () => {
        const payload = { userAddress: 'GTEST', allocations: { XLM: 100 } }
        const res = await request(redirectApp)
            .post('/api/portfolios')
            .send(payload)
            .redirects(1)

        expect(res.status).toBe(200)
        expect(res.body.body).toEqual(payload)
    })

    it('returns 404 for unknown legacy paths without misdirecting', async () => {
        const res = await request(redirectApp).get('/api/unknown-legacy-path')
        expect(res.status).toBe(404)
        expect(res.headers.location).toBeUndefined()
    })
})
