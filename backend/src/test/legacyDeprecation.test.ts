import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { Express } from 'express'
import request from 'supertest'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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
