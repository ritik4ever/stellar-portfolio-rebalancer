import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../utils/apiResponse.js', async () => {
    const actual = await vi.importActual<typeof import('../utils/apiResponse.js')>('../utils/apiResponse.js')
    return actual
})

describe('rateLimit middleware', () => {
    it('sets X-RateLimit-Limit on v1 responses and decrements remaining', async () => {
        vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000')
        vi.stubEnv('RATE_LIMIT_WRITE_MAX', '2')
        vi.resetModules()

        const { writeRateLimiter } = await import('../middleware/rateLimit.js')
        const app = express()
        app.use(express.json())
        app.post('/api/v1/test', writeRateLimiter, (_req, res) => {
            res.json({ ok: true })
        })

        const first = await request(app).post('/api/v1/test').send({ ok: true }).expect(200)
        const second = await request(app).post('/api/v1/test').send({ ok: true }).expect(200)

        const firstLimit = Number(first.headers['x-ratelimit-limit'])
        const firstRemaining = Number(first.headers['x-ratelimit-remaining'])
        const secondRemaining = Number(second.headers['x-ratelimit-remaining'])

        expect(Number.isInteger(firstLimit)).toBe(true)
        expect(firstLimit).toBeGreaterThan(0)
        expect(Number.isInteger(firstRemaining)).toBe(true)
        expect(Number.isInteger(secondRemaining)).toBe(true)
        expect(secondRemaining).toBeLessThan(firstRemaining)
    })

    it('returns Retry-After with a valid integer on 429 responses', async () => {
        vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000')
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
        expect(second.headers['x-ratelimit-limit']).toBeDefined()
        expect(second.headers['x-ratelimit-remaining']).toBeDefined()
        expect(Number.isInteger(Number(second.headers['retry-after']))).toBe(true)
        expect(Number(second.headers['retry-after'])).toBeGreaterThan(0)
    })

    it('reports redis store type when redis is available', async () => {
        vi.resetModules()
        vi.doMock('../queue/connection.js', async () => {
            const actual = await vi.importActual<typeof import('../queue/connection.js')>('../queue/connection.js')
            return {
                ...actual,
                getCachedRedisAvailability: () => true
            }
        })

        const { getRateLimitStoreType } = await import('../middleware/rateLimit.js')
        expect(getRateLimitStoreType()).toBe('redis')
    })

    it('reports memory store type when redis is unavailable', async () => {
        vi.resetModules()
        vi.doMock('../queue/connection.js', async () => {
            const actual = await vi.importActual<typeof import('../queue/connection.js')>('../queue/connection.js')
            return {
                ...actual,
                getCachedRedisAvailability: () => false
            }
        })

        const { getRateLimitStoreType } = await import('../middleware/rateLimit.js')
        expect(getRateLimitStoreType()).toBe('memory')
    })

    it('dynamicRateLimiter applies auth limit on POST /api/auth/login', async () => {
        vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000')
        vi.stubEnv('RATE_LIMIT_AUTH_MAX', '3')
        vi.resetModules()

        const { dynamicRateLimiter } = await import('../middleware/rateLimit.js')
        const app = express()
        app.use(express.json())
        app.post('/api/auth/login', dynamicRateLimiter, (_req, res) => {
            res.json({ ok: true })
        })

        // 3 requests allowed, 4th throttled
        await request(app).post('/api/auth/login').send({}).expect(200)
        await request(app).post('/api/auth/login').send({}).expect(200)
        await request(app).post('/api/auth/login').send({}).expect(200)
        const fourth = await request(app).post('/api/auth/login').send({}).expect(429)
        expect(fourth.headers['x-ratelimit-limit-type']).toBe('authentication')
    })

    it('dynamicRateLimiter falls back to globalRateLimiter for unmapped routes', async () => {
        vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000')
        vi.stubEnv('RATE_LIMIT_MAX', '2')
        vi.resetModules()

        const { dynamicRateLimiter } = await import('../middleware/rateLimit.js')
        const app = express()
        app.use(express.json())
        app.get('/unmapped-route', dynamicRateLimiter, (_req, res) => {
            res.json({ ok: true })
        })

        await request(app).get('/unmapped-route').expect(200)
        await request(app).get('/unmapped-route').expect(200)
        const third = await request(app).get('/unmapped-route').expect(429)
        expect(third.headers['x-ratelimit-limit-type']).toBe('global')
    })

    it('dynamicRateLimiter skips rate limiting for health and readiness probes', async () => {
        vi.stubEnv('RATE_LIMIT_WINDOW_MS', '60000')
        vi.stubEnv('RATE_LIMIT_MAX', '1')
        vi.resetModules()

        const { dynamicRateLimiter } = await import('../middleware/rateLimit.js')
        const app = express()
        app.use(express.json())
        app.get('/health', dynamicRateLimiter, (_req, res) => {
            res.json({ ok: true })
        })

        // Probes are skipped, so multiple requests will succeed regardless of limit
        await request(app).get('/health').expect(200)
        await request(app).get('/health').expect(200)
        await request(app).get('/health').expect(200)
    })
})
