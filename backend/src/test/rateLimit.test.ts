import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../utils/apiResponse.js', async () => {
    const actual = await vi.importActual<typeof import('../utils/apiResponse.js')>('../utils/apiResponse.js')
    return actual
})

describe('rateLimit middleware', () => {
    it('returns standardized RATE_LIMITED response with retry metadata', async () => {
        vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000')
        vi.stubEnv('RATE_LIMIT_MAX', '1')
        vi.stubEnv('RATE_LIMIT_WRITE_MAX', '1')
        vi.resetModules()

        const { writeRateLimiter } = await import('../middleware/rateLimit.js')

        const app = express()
        app.use(express.json())
        app.post('/test', writeRateLimiter, (_req, res) => {
            res.json({ ok: true })
        })

        await request(app).post('/test').send({ ok: true }).expect(200)
        const second = await request(app).post('/test').send({ ok: true }).expect(429)

        expect(second.body.success).toBe(false)
        expect(second.body.error.code).toBe('RATE_LIMITED')
        expect(second.body.meta.retryAfter).toBeDefined()
        expect(second.headers['retry-after']).toBeDefined()
    })
})
