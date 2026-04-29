import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { Express } from 'express'
import request from 'supertest'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let app: Express
let testDbPath: string
let generateAccessToken: (address: string) => string
let databaseService: typeof import('../services/databaseService.js').databaseService
const envBackup: NodeJS.ProcessEnv = { ...process.env }

const testUser = (prefix: string) => `G${prefix}${Math.random().toString(36).slice(2, 12).toUpperCase()}`

beforeAll(async () => {
    const testDir = join(tmpdir(), `stellar-consent-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    testDbPath = join(testDir, 'consent-routes.db')

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
    process.env.RATE_LIMIT_AUTH_MAX = '100'

    const express = (await import('express')).default
    const { mountApiRoutes } = await import('../http/mountApiRoutes.js')
    ;({ generateAccessToken } = await import('../services/authService.js'))
    ;({ databaseService } = await import('../services/databaseService.js'))

    app = express()
    app.use(express.json({ limit: '10mb' }))
    app.set('trust proxy', 1)
    mountApiRoutes(app)
})

afterAll(() => {
    process.env = { ...envBackup }
    if (existsSync(testDbPath)) {
        rmSync(testDbPath, { force: true })
    }
    vi.restoreAllMocks()
})

describe('consent routes integration', () => {
    it('POST /api/v1/consent/grant persists consent with timestamp and IP', async () => {
        const userId = testUser('GRANT')
        const token = generateAccessToken(userId)

        const grant = await request(app)
            .post('/api/v1/consent/grant')
            .set('Authorization', `Bearer ${token}`)
            .set('User-Agent', 'consent-route-test')
            .set('X-Forwarded-For', '203.0.113.44')
            .send({})
            .expect(200)

        expect(grant.body.data.accepted).toBe(true)
        expect(grant.body.data.userId).toBe(userId)
        expect(grant.body.data.termsAcceptedAt).toBeTruthy()
        expect(grant.body.data.privacyAcceptedAt).toBeTruthy()
        expect(grant.body.data.cookieAcceptedAt).toBeTruthy()
        expect(grant.body.data.active).toBe(true)
        expect(grant.body.data.ipAddress).toBe('203.0.113.44')

        const status = await request(app)
            .get('/api/v1/consent/status')
            .query({ userId })
            .expect(200)

        expect(status.body.data.accepted).toBe(true)
        expect(status.body.data.active).toBe(true)
    })

    it('POST /api/v1/consent/revoke marks consent as revoked and blocks future exports', async () => {
        const userId = testUser('REVOKE')
        const token = generateAccessToken(userId)
        const portfolioId = databaseService.createPortfolioWithBalances(
            userId,
            { XLM: 60, USDC: 40 },
            5,
            { XLM: 100, USDC: 100 }
        )

        await request(app)
            .post('/api/v1/consent/grant')
            .set('Authorization', `Bearer ${token}`)
            .send({})
            .expect(200)

        const revoke = await request(app)
            .post('/api/v1/consent/revoke')
            .set('Authorization', `Bearer ${token}`)
            .send({})
            .expect(200)

        expect(revoke.body.data.accepted).toBe(false)
        expect(revoke.body.data.active).toBe(false)
        expect(revoke.body.data.revokedAt).toBeTruthy()

        const blocked = await request(app)
            .get(`/api/v1/portfolio/${portfolioId}/export`)
            .query({ format: 'json' })
            .set('Authorization', `Bearer ${token}`)
            .expect(403)

        expect(blocked.body.error?.code).toBe('FORBIDDEN')
    })

    it('GET /api/v1/consent/audit returns an append-only log of all consent events', async () => {
        const userId = testUser('AUDIT')
        const token = generateAccessToken(userId)

        await request(app)
            .post('/api/v1/consent/grant')
            .set('Authorization', `Bearer ${token}`)
            .send({})
            .expect(200)

        await request(app)
            .post('/api/v1/consent/revoke')
            .set('Authorization', `Bearer ${token}`)
            .send({})
            .expect(200)

        const audit = await request(app)
            .get('/api/v1/consent/audit')
            .set('Authorization', `Bearer ${token}`)
            .expect(200)

        expect(audit.body.data.userId).toBe(userId)
        expect(audit.body.data.events).toHaveLength(2)
        expect(audit.body.data.events.map((event: { action: string }) => event.action)).toEqual(['grant', 'revoke'])
        expect(audit.body.data.events[0].timestamp).toBeTruthy()
        expect(audit.body.data.events[1].timestamp).toBeTruthy()
    })

    it('blocks data export without active consent', async () => {
        const userId = testUser('NOCONSENT')
        const token = generateAccessToken(userId)
        const portfolioId = databaseService.createPortfolioWithBalances(
            userId,
            { XLM: 50, USDC: 50 },
            5,
            { XLM: 100, USDC: 100 }
        )

        const blocked = await request(app)
            .get(`/api/v1/portfolio/${portfolioId}/export`)
            .query({ format: 'json' })
            .set('Authorization', `Bearer ${token}`)
            .expect(403)

        expect(blocked.body.error?.code).toBe('FORBIDDEN')
    })
})
