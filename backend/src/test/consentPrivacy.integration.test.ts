import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { Express } from 'express'
import request from 'supertest'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let app: Express
let testDbPath: string
const envBackup: NodeJS.ProcessEnv = { ...process.env }

beforeAll(async () => {
    const testDir = join(tmpdir(), `stellar-consent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    testDbPath = join(testDir, 'consent.db')

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
    const { portfolioRouter } = await import('../api/routes.js')
    const { authRouter } = await import('../api/authRoutes.js')

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
    app.use('/api', portfolioRouter)
    app.use('/api/auth', authRouter)
})

afterAll(() => {
    process.env = { ...envBackup }
    if (existsSync(testDbPath)) {
        try {
            rmSync(testDbPath, { force: true })
        } catch {
            /* ignore */
        }
    }
    vi.restoreAllMocks()
})

describe('consent and privacy API', () => {
    it('GET /api/consent/status returns 400 when userId is missing', async () => {
        const res = await request(app).get('/api/consent/status').expect(400)
        expect(res.body.success).toBe(false)
        expect(res.body.error?.code).toBe('VALIDATION_ERROR')
    })

    it('GET /api/consent/status returns accepted false for a user with no consent', async () => {
        const userId = `GNOCONSENT${Math.random().toString(36).slice(2, 14)}`
        const res = await request(app).get('/api/consent/status').query({ userId }).expect(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data.accepted).toBe(false)
        expect(res.body.data.termsAcceptedAt).toBeNull()
        expect(res.body.data.privacyAcceptedAt).toBeNull()
        expect(res.body.data.cookieAcceptedAt).toBeNull()
    })

    it('GET /api/consent/status accepts user_id as query alias', async () => {
        const userId = `GALIAS${Math.random().toString(36).slice(2, 14)}`
        const res = await request(app).get('/api/consent/status').query({ user_id: userId }).expect(200)
        expect(res.body.data.accepted).toBe(false)
    })

    it('POST /api/consent records full consent and status reflects it', async () => {
        const userId = `GCONSENTOK${Math.random().toString(36).slice(2, 12)}`
        const postRes = await request(app)
            .post('/api/consent')
            .send({ userId, terms: true, privacy: true, cookies: true })
            .expect(200)
        expect(postRes.body.success).toBe(true)
        expect(postRes.body.data.accepted).toBe(true)

        const getRes = await request(app).get('/api/consent/status').query({ userId }).expect(200)
        expect(getRes.body.data.accepted).toBe(true)
        expect(getRes.body.data.termsAcceptedAt).toBeTruthy()
        expect(getRes.body.data.privacyAcceptedAt).toBeTruthy()
        expect(getRes.body.data.cookieAcceptedAt).toBeTruthy()
    })

    it('POST /api/consent returns 400 when userId is missing', async () => {
        const res = await request(app)
            .post('/api/consent')
            .send({ terms: true, privacy: true, cookies: true })
            .expect(400)
        expect(res.body.error?.code).toBe('VALIDATION_ERROR')
    })

    it('POST /api/consent returns 400 when boolean fields are not booleans', async () => {
        const userId = `GINVALID${Math.random().toString(36).slice(2, 12)}`
        const res = await request(app)
            .post('/api/consent')
            .send({ userId, terms: 'yes', privacy: true, cookies: true })
            .expect(400)
        expect(res.body.error?.code).toBe('VALIDATION_ERROR')
    })

    it('POST /api/consent returns 400 when any required acceptance is false', async () => {
        const userId = `GPARTIAL${Math.random().toString(36).slice(2, 12)}`
        const res = await request(app)
            .post('/api/consent')
            .send({ userId, terms: true, privacy: true, cookies: false })
            .expect(400)
        expect(res.body.error?.code).toBe('VALIDATION_ERROR')
    })

    it('DELETE /api/user/:address/data returns 403 when JWT subject does not match address', async () => {
        const { generateAccessToken } = await import('../services/authService.js')
        const victim = `GVICTIM${Math.random().toString(36).slice(2, 12)}`
        const attacker = `GATTACK${Math.random().toString(36).slice(2, 12)}`
        const token = generateAccessToken(attacker)
        const res = await request(app)
            .delete(`/api/user/${victim}/data`)
            .set('Authorization', `Bearer ${token}`)
            .expect(403)
        expect(res.body.error?.code).toBe('FORBIDDEN')
    })

    it('DELETE /api/user/:address/data returns 401 without Authorization when JWT is required', async () => {
        const userId = `GNOAUTH${Math.random().toString(36).slice(2, 12)}`
        const res = await request(app).delete(`/api/user/${userId}/data`).expect(401)
        expect(res.body.error?.code).toBe('UNAUTHORIZED')
    })

    it('DELETE /api/user/:address/data clears consent and portfolios for the owner', async () => {
        const { generateAccessToken } = await import('../services/authService.js')
        const userId = `GOWNER${Math.random().toString(36).slice(2, 12)}`
        await request(app)
            .post('/api/consent')
            .send({ userId, terms: true, privacy: true, cookies: true })
            .expect(200)

        const createRes = await request(app)
            .post('/api/portfolio')
            .send({
                userAddress: userId,
                allocations: { XLM: 60, USDC: 40 },
                threshold: 5
            })
        expect([200, 201]).toContain(createRes.status)

        const token = generateAccessToken(userId)
        const delRes = await request(app)
            .delete(`/api/user/${userId}/data`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200)
        expect(delRes.body.success).toBe(true)

        const statusRes = await request(app).get('/api/consent/status').query({ userId }).expect(200)
        expect(statusRes.body.data.accepted).toBe(false)
        expect(statusRes.body.data.termsAcceptedAt).toBeNull()

        const portfoliosRes = await request(app)
            .get(`/api/user/${userId}/portfolios`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200)
        expect(portfoliosRes.body.data.portfolios).toEqual([])
    })

    it('GET /api/user/:address/portfolios returns 401 without Authorization when JWT is required', async () => {
        const victim = `GVISIT${Math.random().toString(36).slice(2, 12)}`
        const res = await request(app).get(`/api/user/${victim}/portfolios`).expect(401)
        expect(res.body.error?.code).toBe('UNAUTHORIZED')
    })

    it('GET /api/user/:address/portfolios returns 403 when JWT subject does not match address', async () => {
        const { generateAccessToken } = await import('../services/authService.js')
        const victim = `GVICTIM${Math.random().toString(36).slice(2, 12)}`
        const attacker = `GATTACK${Math.random().toString(36).slice(2, 12)}`
        const token = generateAccessToken(attacker)

        const res = await request(app)
            .get(`/api/user/${victim}/portfolios`)
            .set('Authorization', `Bearer ${token}`)
            .expect(403)
        expect(res.body.error?.code).toBe('FORBIDDEN')
    })

    it('GET /api/user/:address/portfolios returns portfolios for the authenticated owner', async () => {
        const { generateAccessToken } = await import('../services/authService.js')
        const userId = `GOWNER${Math.random().toString(36).slice(2, 12)}`

        const createRes = await request(app)
            .post('/api/portfolio')
            .send({
                userAddress: userId,
                allocations: { XLM: 60, USDC: 40 },
                threshold: 5
            })
        expect([200, 201]).toContain(createRes.status)

        const token = generateAccessToken(userId)
        const portfoliosRes = await request(app)
            .get(`/api/user/${userId}/portfolios`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200)

        expect(portfoliosRes.body.success).toBe(true)
        expect(Array.isArray(portfoliosRes.body.data.portfolios)).toBe(true)
        expect(portfoliosRes.body.data.portfolios.length).toBeGreaterThan(0)
        expect(portfoliosRes.body.data.portfolios.every((p: any) => p.userAddress === userId)).toBe(true)
    })

    it('after DELETE user data, refresh token is rejected', async () => {
        const userId = `GREFRESH${Math.random().toString(36).slice(2, 12)}`
        const loginRes = await request(app).post('/api/auth/login').send({ address: userId }).expect(200)
        const refreshToken = loginRes.body.data.refreshToken
        expect(refreshToken).toBeTruthy()

        const { generateAccessToken } = await import('../services/authService.js')
        const accessToken = generateAccessToken(userId)
        await request(app)
            .delete(`/api/user/${userId}/data`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200)

        const refreshAfter = await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken })
            .expect(401)
        expect(refreshAfter.body.error?.code).toBe('UNAUTHORIZED')
    })
})
