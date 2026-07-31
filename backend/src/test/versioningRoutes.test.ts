import { beforeAll, describe, expect, it, vi } from 'vitest'
import express, { type Express } from 'express'
import request from 'supertest'

vi.mock('../queue/connection.js', () => ({
    isRedisAvailable: vi.fn().mockResolvedValue(true),
    isRedisConnected: vi.fn().mockReturnValue(true),
}))

vi.mock('../services/reflector.js', () => ({
    ReflectorService: vi.fn().mockImplementation(function(this: any) {
        this.testApiConnectivity = vi.fn().mockResolvedValue({ success: true })
        this.getCurrentPrices = vi.fn().mockResolvedValue({ XLM: 0.12, USDC: 1.0 })
        return this
    })
}))

import { v1Router } from '../api/v1Router.js'
import { legacyApiDeprecation } from '../middleware/legacyApiDeprecation.js'

let app: Express

beforeAll(() => {
    delete process.env.STELLAR_HORIZON_URL
    app = express()
    app.use(express.json())
    app.use('/api/v1', v1Router)
    app.use('/api', legacyApiDeprecation, v1Router)
})

describe('API version namespace wiring', () => {
    it('uses /api/v1 as the canonical router namespace', async () => {
        const res = await request(app).get('/api/v1/health').expect(200)
        expect(res.body.status).toBe('healthy')
        expect(res.headers.deprecation).toBeUndefined()
    })

    it('keeps /api as a deprecated compatibility alias', async () => {
        const res = await request(app).get('/api/health').expect(200)
        expect(res.body.status).toBe('healthy')
        expect(res.headers.deprecation).toBe('true')
        expect(res.headers.sunset).toBe('Wed, 01 Jul 2026 00:00:00 GMT')
        expect(res.headers.link).toContain('/docs/api-migration-v1.md')
    })
})
