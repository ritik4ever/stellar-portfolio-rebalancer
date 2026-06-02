import { describe, it, expect, beforeAll, vi } from 'vitest'
import express, { Express } from 'express'
import request from 'supertest'

// Enable debug routes for all tests in this file
vi.mock('../config/featureFlags.js', () => ({
    getFeatureFlags: () => ({ enableDebugRoutes: true })
}))

// Mock requireAdmin to pass through
vi.mock('../middleware/auth.js', () => ({
    requireAdmin: (_req: any, _res: any, next: any) => next()
}))

// Mock adminRateLimiter to pass through
vi.mock('../middleware/rateLimit.js', () => ({
    adminRateLimiter: (_req: any, _res: any, next: any) => next()
}))

// Mock reflector service — factory must be self-contained (vi.mock is hoisted)
vi.mock('../services/reflector.js', () => {
    const instance = {
        clearCache: () => undefined,
        getCacheStatus: () => ({ cached: false }),
        getCurrentPricesWithMeta: async () => ({ prices: { XLM: 0.1 }, feedMeta: {} }),
        testApiConnectivity: async () => ({ ok: true }),
    }
    return { ReflectorService: function () { return instance } }
})

// Mock runtimeServices
vi.mock('../services/runtimeServices.js', () => ({
    autoRebalancer: null
}))

// Mock portfolioStorage
vi.mock('../services/portfolioStorage.js', () => ({
    portfolioStorage: { getPortfolioCount: async () => 0 }
}))

// Mock notificationService
vi.mock('../services/notificationService.js', () => ({
    notificationService: {
        getPreferences: () => ({
            emailEnabled: true,
            emailAddress: 'user@example.com',
            webhookEnabled: true,
            webhookUrl: 'https://hooks.example.com/secret-token',
        }),
        notify: async () => undefined,
    }
}))

let app: Express

beforeAll(async () => {
    app = express()
    app.use(express.json())
    const { debugRouter } = await import('../api/debug.routes.js')
    app.use('/api', debugRouter)
})

describe('debug routes — secret redaction', () => {
    it('GET /debug/coingecko-test does not expose testUrl', async () => {
        const res = await request(app).get('/api/debug/coingecko-test')
        expect(res.status).toBe(200)
        expect(res.body.data).not.toHaveProperty('testUrl')
        expect(res.body.data).toHaveProperty('apiKeySet')
        expect(res.body.data).toHaveProperty('responseStatus')
    })

    it('GET /debug/reflector-test does not expose apiKeyLength', async () => {
        const res = await request(app).get('/api/debug/reflector-test')
        expect(res.status).toBe(200)
        expect(res.body.data.environment).not.toHaveProperty('apiKeyLength')
        expect(res.body.data.environment).toHaveProperty('apiKeySet')
    })

    it('POST /debug/notifications/test redacts email and webhook in sentTo', async () => {
        const res = await request(app)
            .post('/api/debug/notifications/test')
            .send({ userId: 'GUSER123', eventType: 'rebalance' })
        expect(res.status).toBe(200)
        expect(res.body.data.sentTo.email).toBe('[REDACTED]')
        expect(res.body.data.sentTo.webhook).toBe('[REDACTED]')
    })
})
