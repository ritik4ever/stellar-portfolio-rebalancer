import { describe, it, expect, beforeAll, vi, afterAll } from 'vitest'
import express, { Express } from 'express'
import request from 'supertest'

// Debug router must only be mounted when ENABLE_DEBUG_ROUTES=true and NODE_ENV is not production.
// These tests exercise the conditional mount logic in routes.ts.
const originalEnv = { ...process.env }

vi.mock('../middleware/auth.js', () => ({
    requireAdmin: (_req: any, _res: any, next: any) => next(),
    requireAuth: (_req: any, _res: any, next: any) => next(),
    optionalAuth: (_req: any, _res: any, next: any) => next(),
}))

vi.mock('../middleware/rateLimit.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../middleware/rateLimit.js')>()
    return {
        ...actual,
        adminRateLimiter: (_req: any, _res: any, next: any) => next(),
        protectedWriteLimiter: [(_req: any, _res: any, next: any) => next()],
        protectedCriticalLimiter: [(_req: any, _res: any, next: any) => next()],
    }
})

vi.mock('../utils/logger.js', () => ({
    logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
    }
}))

async function buildApp(): Promise<Express> {
    vi.resetModules()
    const { portfolioRouter } = await import('../api/routes.js')
    const app = express()
    app.use(express.json())
    app.use('/api', portfolioRouter)
    return app
}

describe('debug routes conditional mount (issue #1427)', () => {
    beforeAll(() => {
        delete process.env.ENABLE_DEBUG_ROUTES
        process.env.NODE_ENV = 'test'
    })

    afterAll(() => {
        process.env = { ...originalEnv }
    })

    it('returns 404 when ENABLE_DEBUG_ROUTES is unset (disabled by default)', async () => {
        delete process.env.ENABLE_DEBUG_ROUTES
        const app = await buildApp()
        const res = await request(app).get('/api/debug/env')
        expect(res.status).toBe(404)
    })

    it('returns 404 when ENABLE_DEBUG_ROUTES=false', async () => {
        process.env.ENABLE_DEBUG_ROUTES = 'false'
        const app = await buildApp()
        const res = await request(app).get('/api/debug/env')
        expect(res.status).toBe(404)
    })

    it('mounts debug routes when ENABLE_DEBUG_ROUTES=true in non-production', async () => {
        process.env.ENABLE_DEBUG_ROUTES = 'true'
        process.env.NODE_ENV = 'test'
        const app = await buildApp()
        const res = await request(app).get('/api/debug/env')
        expect(res.status).toBe(200)
        expect(res.body.data).toHaveProperty('environment')
    })
})
