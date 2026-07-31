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
        expect(status.body.data.documentVersion).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') // Sentinel empty hash
    })

    it('POST /api/v1/consent/grant computes, persists, and returns document_version hash when documentText is provided', async () => {
        const userId = testUser('GRANTVER')
        const token = generateAccessToken(userId)
        const docText = 'Terms and Conditions v2.0 - Agree to Stellar Portfolio Rebalancer'
        const expectedHash = '66319e1f1025874cd1a7edb6b6f115a0637008723c02b28a428bbb6b05058e67' // sha256 hash of the docText

        const grant = await request(app)
            .post('/api/v1/consent/grant')
            .set('Authorization', `Bearer ${token}`)
            .send({ documentText: docText })
            .expect(200)

        expect(grant.body.data.accepted).toBe(true)
        expect(grant.body.data.documentVersion).toBe(expectedHash)

        const status = await request(app)
            .get('/api/v1/consent/status')
            .query({ userId })
            .expect(200)

        expect(status.body.data.documentVersion).toBe(expectedHash)

        const audit = await request(app)
            .get('/api/v1/consent/audit')
            .set('Authorization', `Bearer ${token}`)
            .expect(200)

        expect(audit.body.data.events).toHaveLength(1)
        expect(audit.body.data.events[0].documentVersion).toBe(expectedHash)
    })

    it('POST /api/v1/consent/revoke accepts documentText and stores the version hash in the audit event', async () => {
        const userId = testUser('REVOKEVER')
        const token = generateAccessToken(userId)
        const docText = 'Revocation Text v1.0'
        const expectedHash = '075c92235a9d8bb46dcbd164824d0ea2db7a8505fb1d949dd382547c4ea0b0eb' // sha256 of docText

        await request(app)
            .post('/api/v1/consent/grant')
            .set('Authorization', `Bearer ${token}`)
            .send({})
            .expect(200)

        const revoke = await request(app)
            .post('/api/v1/consent/revoke')
            .set('Authorization', `Bearer ${token}`)
            .send({ documentText: docText })
            .expect(200)

        expect(revoke.body.data.documentVersion).toBe(expectedHash)

        const audit = await request(app)
            .get('/api/v1/consent/audit')
            .set('Authorization', `Bearer ${token}`)
            .expect(200)

        expect(audit.body.data.events).toHaveLength(2)
        expect(audit.body.data.events[1].action).toBe('revoke')
        expect(audit.body.data.events[1].documentVersion).toBe(expectedHash)
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

    it('POST /api/v1/consent/audit/purge deletes old audit events', async () => {
        const userId = testUser('PURGE')
        const token = generateAccessToken(userId)

        await request(app)
            .post('/api/v1/consent/grant')
            .set('Authorization', `Bearer ${token}`)
            .send({})
            .expect(200)

        const auditBefore = await request(app)
            .get('/api/v1/consent/audit')
            .set('Authorization', `Bearer ${token}`)
            .expect(200)
        expect(auditBefore.body.data.events.length).toBeGreaterThan(0)

        const purge = await request(app)
            .post('/api/v1/consent/audit/purge')
            .set('Authorization', `Bearer ${token}`)
            .send({ retentionDays: 0 })
            .expect(200)

        expect(purge.body.data.deletedCount).toBeGreaterThan(0)
        expect(purge.body.data.retentionDays).toBe(0)
    })

    it('GET /api/v1/consent/history returns consent record and full audit history for the authenticated user', async () => {
        const userId = testUser('HISTORY')
        const token = generateAccessToken(userId)

        const historyBefore = await request(app)
            .get('/api/v1/consent/history')
            .set('Authorization', `Bearer ${token}`)
            .expect(200)

        expect(historyBefore.body.data.userId).toBe(userId)
        expect(historyBefore.body.data.consent).toBeNull()
        expect(historyBefore.body.data.history).toEqual([])

        await request(app)
            .post('/api/v1/consent/grant')
            .set('Authorization', `Bearer ${token}`)
            .send({ documentText: 'Terms v1' })
            .expect(200)

        const historyAfter = await request(app)
            .get('/api/v1/consent/history')
            .set('Authorization', `Bearer ${token}`)
            .expect(200)

        expect(historyAfter.body.data.userId).toBe(userId)
        expect(historyAfter.body.data.consent).not.toBeNull()
        expect(historyAfter.body.data.consent.active).toBe(true)
        expect(historyAfter.body.data.consent.documentVersion).toBeTruthy()
        expect(historyAfter.body.data.history).toHaveLength(1)
        expect(historyAfter.body.data.history[0].action).toBe('grant')
        expect(historyAfter.body.data.history[0].timestamp).toBeTruthy()
        expect(historyAfter.body.data.history[0].documentVersion).toBeTruthy()
    })

    it('GET /api/v1/consent/history returns 401 without auth', async () => {
        await request(app)
            .get('/api/v1/consent/history')
            .expect(401)
    })

    it('POST /api/v1/consent/audit/purge returns 400 for invalid retentionDays', async () => {
        const userId = testUser('PURGEINV')
        const token = generateAccessToken(userId)

        const purge = await request(app)
            .post('/api/v1/consent/audit/purge')
            .set('Authorization', `Bearer ${token}`)
            .send({ retentionDays: -1 })
            .expect(400)

        expect(purge.body.error?.code).toBe('VALIDATION_ERROR')
    })
})
