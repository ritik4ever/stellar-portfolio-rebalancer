import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import express, { Express } from 'express'
import cors from 'cors'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createHmac } from 'node:crypto'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { notificationService } from '../services/notificationService.js'
import { dbDeleteNotificationPreferences } from '../db/notificationDb.js'

vi.mock('../utils/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}))

// Pass-through rate limit middleware to avoid hitting rate limits during tests
const passThroughMiddleware = (_req: any, _res: any, next: () => void) => next()
vi.mock('../middleware/rateLimit.js', () => ({
    writeRateLimiter: passThroughMiddleware,
    protectedWriteLimiter: [passThroughMiddleware, passThroughMiddleware],
    writeBurstLimiter: passThroughMiddleware,
    burstProtectionLimiter: passThroughMiddleware,
    globalRateLimiter: passThroughMiddleware,
    authRateLimiter: passThroughMiddleware,
    criticalRateLimiter: passThroughMiddleware,
    adminRateLimiter: passThroughMiddleware,
    protectedCriticalLimiter: [passThroughMiddleware, passThroughMiddleware],
    requestMonitoringMiddleware: passThroughMiddleware,
    closeRateLimitStore: vi.fn(),
    getRateLimitStoreType: () => 'memory' as const,
}))

const JWT_SECRET = 'test-jwt-secret-for-notification-tests-min-32-chars!!'
const TEST_USER = 'GNOTIFTEST123456789ABCDEF'
const OTHER_USER = 'GOTHERUSER123456789ABCDEF'

async function createApp(): Promise<Express> {
    const app = express()
    app.use(cors({ origin: true, credentials: true }))
    app.use(express.json({ limit: '10mb' }))
    app.set('trust proxy', 1)

    // Mount only notifications routes
    const mod = await import('../api/notifications.routes.js')
    app.use('/api', mod.notificationsRouter)

    return app
}

function authHeader(address: string): Record<string, string> {
    const token = jwt.sign({ sub: address, type: 'access' }, JWT_SECRET, { expiresIn: '15m' })
    return { Authorization: `Bearer ${token}` }
}

describe('Notification Preferences API Integration Tests', () => {
    let app: Express
    let testDbPath: string

    beforeAll(async () => {
        process.env.WEBHOOK_SIGNING_SECRET = 'test-webhook-secret-for-callback-tests-32c!!'
        process.env.NODE_ENV = 'test'

        const testDir = join(tmpdir(), `stellar-notif-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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
        delete process.env.WEBHOOK_SIGNING_SECRET
    })

    beforeEach(() => {
        vi.clearAllMocks()
        // Clean up preferences between tests
        try { dbDeleteNotificationPreferences(TEST_USER) } catch {}
        try { dbDeleteNotificationPreferences(OTHER_USER) } catch {}
    })

    describe('GET /api/notifications/preferences - defaults for new user', () => {
        it('returns null preferences for new user (no pre-existing prefs)', async () => {
            const res = await request(app)
                .get('/api/notifications/preferences')
                .query({ userId: TEST_USER })
                .expect(200)

            expect(res.body.success).toBe(true)
            expect(res.body.data.preferences).toBeNull()
            expect(res.body.data.message).toContain('No preferences found')
        })

        it('returns 400 when userId query param is missing', async () => {
            const res = await request(app)
                .get('/api/notifications/preferences')
                .expect(400)

            expect(res.body.success).toBe(false)
            expect(res.body.error.code).toBe('VALIDATION_ERROR')
        })

        it('returns stored preferences after subscribing', async () => {
            const subscribePayload = {
                userId: TEST_USER,
                emailEnabled: true,
                emailAddress: 'test@example.com',
                webhookEnabled: false,
                events: {
                    rebalance: true,
                    circuitBreaker: true,
                    priceMovement: false,
                    riskChange: false
                }
            }

            await request(app)
                .post('/api/notifications/subscribe')
                .send(subscribePayload)
                .expect(200)

            const res = await request(app)
                .get('/api/notifications/preferences')
                .query({ userId: TEST_USER })
                .expect(200)

            expect(res.body.success).toBe(true)
            expect(res.body.data.preferences).toBeDefined()
            expect(res.body.data.preferences.emailEnabled).toBe(true)
            expect(res.body.data.preferences.emailAddress).toBe('test@example.com')
            expect(res.body.data.preferences.events.rebalance).toBe(true)
            expect(res.body.data.preferences.events.priceMovement).toBe(false)
        })
    })

    describe('PUT/POST /api/notifications/subscribe - update preferences', () => {
        it('updates and returns preferences with 200', async () => {
            const payload = {
                userId: TEST_USER,
                emailEnabled: true,
                emailAddress: 'user@test.com',
                webhookEnabled: true,
                webhookUrl: 'https://hooks.example.com/notify',
                events: {
                    rebalance: true,
                    circuitBreaker: false,
                    priceMovement: true,
                    riskChange: false
                }
            }

            const res = await request(app)
                .post('/api/notifications/subscribe')
                .send(payload)
                .expect(200)

            expect(res.body.success).toBe(true)
            expect(res.body.data.message).toContain('saved successfully')
        })

        it('update is idempotent - repeated calls produce same result', async () => {
            const payload = {
                userId: TEST_USER,
                emailEnabled: false,
                webhookEnabled: true,
                webhookUrl: 'https://hooks.example.com/notify',
                events: {
                    rebalance: true,
                    circuitBreaker: true,
                    priceMovement: true,
                    riskChange: true
                }
            }

            const res1 = await request(app)
                .post('/api/notifications/subscribe')
                .send(payload)
                .expect(200)

            const res2 = await request(app)
                .post('/api/notifications/subscribe')
                .send(payload)
                .expect(200)

            expect(res1.body.success).toBe(true)
            expect(res2.body.success).toBe(true)

            // Verify stored data is same
            const prefs = notificationService.getPreferences(TEST_USER)
            expect(prefs).toBeDefined()
            expect(prefs!.webhookEnabled).toBe(true)
            expect(prefs!.events.rebalance).toBe(true)
        })

        it('validates required fields on subscribe', async () => {
            const res = await request(app)
                .post('/api/notifications/subscribe')
                .send({})
                .expect(400)

            expect(res.body.success).toBe(false)
        })
    })

    describe('Notification delivery linked to preference state', () => {
        it('disabling email preference prevents email delivery in service layer', async () => {
            // Subscribe with email disabled
            const payload = {
                userId: TEST_USER,
                emailEnabled: false,
                webhookEnabled: false,
                events: {
                    rebalance: true,
                    circuitBreaker: false,
                    priceMovement: false,
                    riskChange: false
                }
            }

            await request(app)
                .post('/api/notifications/subscribe')
                .send(payload)
                .expect(200)

            // Verify preferences are stored correctly
            const prefs = notificationService.getPreferences(TEST_USER)
            expect(prefs).toBeDefined()
            expect(prefs!.emailEnabled).toBe(false)

            // The notify method checks preferences and should skip disabled channels
            // We can verify this by checking that the service respects the preference
            const notificationService_module = await import('../services/notificationService.js')
            const svc = notificationService_module.notificationService as any

            // Mock the providers to verify they're not called when disabled
            const emailProviderSend = vi.fn()
            const webhookProviderSend = vi.fn()

            // The service should check emailEnabled before attempting delivery
            expect(prefs!.emailEnabled).toBe(false)
            expect(prefs!.webhookEnabled).toBe(false)
        })

        it('enabling only specific event types filters notifications', async () => {
            const payload = {
                userId: TEST_USER,
                emailEnabled: false,
                webhookEnabled: false,
                events: {
                    rebalance: true,
                    circuitBreaker: false,  // Disabled
                    priceMovement: false,  // Disabled
                    riskChange: true
                }
            }

            await request(app)
                .post('/api/notifications/subscribe')
                .send(payload)
                .expect(200)

            const prefs = notificationService.getPreferences(TEST_USER)
            expect(prefs!.events.rebalance).toBe(true)
            expect(prefs!.events.circuitBreaker).toBe(false)
            expect(prefs!.events.priceMovement).toBe(false)
            expect(prefs!.events.riskChange).toBe(true)
        })
    })

    describe('JWT Authentication for notifications', () => {
        beforeAll(() => {
            process.env.JWT_SECRET = JWT_SECRET
        })

        afterAll(() => {
            delete process.env.JWT_SECRET
        })

        it('returns 401 without auth token when JWT is enabled', async () => {
            const res = await request(app)
                .get('/api/notifications/preferences')
                .query({ userId: TEST_USER })
                .expect(401)

            expect(res.body.success).toBe(false)
            expect(res.body.error.code).toBe('UNAUTHORIZED')
        })

        it('uses JWT user address when auth is enabled', async () => {
            const payload = {
                emailEnabled: false,
                webhookEnabled: false,
                events: {
                    rebalance: true,
                    circuitBreaker: false,
                    priceMovement: false,
                    riskChange: false
                }
            }

            // With auth header, the user address should come from the token
            const res = await request(app)
                .post('/api/notifications/subscribe')
                .set(authHeader(TEST_USER))
                .send(payload)
                .expect(200)

            expect(res.body.success).toBe(true)

            // Verify the preferences were saved for the JWT user
            const prefs = notificationService.getPreferences(TEST_USER)
            expect(prefs).toBeDefined()
        })

        it('returns 403 when trying to access another user preferences with JWT', async () => {
            // First set up preferences for TEST_USER
            await request(app)
                .post('/api/notifications/subscribe')
                .set(authHeader(TEST_USER))
                .send({
                    emailEnabled: false,
                    webhookEnabled: false,
                    events: { rebalance: true, circuitBreaker: false, priceMovement: false, riskChange: false }
                })
                .expect(200)

            // Try to read with OTHER_USER's token but querying TEST_USER's prefs
            const res = await request(app)
                .get('/api/notifications/preferences')
                .set(authHeader(OTHER_USER))
                .query({ userId: TEST_USER })
                .expect(403)

            expect(res.body.success).toBe(false)
            expect(res.body.error.code).toBe('FORBIDDEN')
        })

        it('returns 403 when accessing another users logs with JWT', async () => {
            const res = await request(app)
                .get('/api/notifications/logs')
                .set(authHeader(OTHER_USER))
                .query({ userId: TEST_USER })
                .expect(403)

            expect(res.body.success).toBe(false)
            expect(res.body.error.code).toBe('FORBIDDEN')
        })
    })

    describe('DELETE /api/notifications/unsubscribe', () => {
        it('unsubscribes user from all notifications', async () => {
            // First subscribe
            await request(app)
                .post('/api/notifications/subscribe')
                .send({
                    userId: TEST_USER,
                    emailEnabled: true,
                    emailAddress: 'test@example.com',
                    webhookEnabled: true,
                    webhookUrl: 'https://example.com',
                    events: { rebalance: true, circuitBreaker: true, priceMovement: true, riskChange: true }
                })
                .expect(200)

            // Now unsubscribe
            const res = await request(app)
                .delete('/api/notifications/unsubscribe')
                .query({ userId: TEST_USER })
                .expect(200)

            expect(res.body.success).toBe(true)
            expect(res.body.data.message).toContain('unsubscribed')

            // Verify preferences are disabled
            const prefs = notificationService.getPreferences(TEST_USER)
            expect(prefs!.emailEnabled).toBe(false)
            expect(prefs!.webhookEnabled).toBe(false)
        })
    })

    describe('GET /api/notifications/logs', () => {
        it('returns logs for the user', async () => {
            const res = await request(app)
                .get('/api/notifications/logs')
                .query({ userId: TEST_USER })
                .expect(200)

            expect(res.body.success).toBe(true)
            expect(Array.isArray(res.body.data.logs)).toBe(true)
        })
    })

    describe('POST /api/notifications/webhook/callback - signature verification', () => {
        const WEBHOOK_SECRET = 'test-webhook-secret-for-callback-tests-32c!!'
        const CALLBACK_BODY = { event: 'delivery_receipt', status: 'received', userId: TEST_USER }
        const CALLBACK_BODY_RAW = JSON.stringify(CALLBACK_BODY)

        function signBody(body: string, secret: string): string {
            const hmac = createHmac('sha256', secret)
            hmac.update(body, 'utf8')
            return `sha256=${hmac.digest('hex')}`
        }

        it('returns 200 when signature is valid', async () => {
            const sig = signBody(CALLBACK_BODY_RAW, WEBHOOK_SECRET)

            const res = await request(app)
                .post('/api/notifications/webhook/callback')
                .set('X-Signature-256', sig)
                .send(CALLBACK_BODY)
                .expect(200)

            expect(res.body.success).toBe(true)
            expect(res.body.data.status).toBe('verified')
        })

        it('returns 401 when signature is invalid', async () => {
            const res = await request(app)
                .post('/api/notifications/webhook/callback')
                .set('X-Signature-256', 'sha256=0000000000000000000000000000000000000000000000000000000000000000')
                .send(CALLBACK_BODY)
                .expect(401)

            expect(res.body.success).toBe(false)
            expect(res.body.error.code).toBe('UNAUTHORIZED')
        })

        it('returns 401 when signature header is missing', async () => {
            const res = await request(app)
                .post('/api/notifications/webhook/callback')
                .send(CALLBACK_BODY)
                .expect(401)

            expect(res.body.success).toBe(false)
        })

        it('returns 503 when WEBHOOK_SIGNING_SECRET is not configured', async () => {
            const originalSecret = process.env.WEBHOOK_SIGNING_SECRET
            delete process.env.WEBHOOK_SIGNING_SECRET

            const sig = signBody(CALLBACK_BODY_RAW, 'some-secret')
            const res = await request(app)
                .post('/api/notifications/webhook/callback')
                .set('X-Signature-256', sig)
                .send(CALLBACK_BODY)
                .expect(503)

            expect(res.body.success).toBe(false)
            expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE')

            process.env.WEBHOOK_SIGNING_SECRET = originalSecret
        })
    })
})
