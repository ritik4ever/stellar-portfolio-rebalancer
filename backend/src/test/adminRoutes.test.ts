import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import express, { Express } from 'express'
import request from 'supertest'
import { Keypair } from '@stellar/stellar-sdk'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function makeAdminHeaders(kp: Keypair) {
    const msg = Date.now().toString()
    const sig = kp.sign(Buffer.from(msg, 'utf8')).toString('base64')
    return {
        'x-public-key': kp.publicKey(),
        'x-message': msg,
        'x-signature': sig,
    }
}

// ─── No ADMIN_PUBLIC_KEYS configured ─────────────────────────────────────────

describe('Admin routes – no ADMIN_PUBLIC_KEYS configured', () => {
    it('returns 503 on any admin route when keys are not set', async () => {
        vi.stubEnv('ADMIN_PUBLIC_KEYS', '')
        vi.resetModules()
        const { requireAdmin } = await import('../middleware/auth.js')
        const app = express()
        app.get('/test', requireAdmin, (_req, res) => res.json({ ok: true }))
        const res = await request(app).get('/test')
        expect(res.status).toBe(503)
        vi.unstubAllEnvs()
    })
})

// ─── Auth protection on admin asset + metrics routes ─────────────────────────

describe('Admin routes – unauthenticated, non-admin, and admin access', () => {
    let app: Express
    let adminKp: Keypair
    let nonAdminKp: Keypair
    let testDbPath: string

    beforeAll(async () => {
        adminKp = Keypair.random()
        nonAdminKp = Keypair.random()
        vi.stubEnv('ADMIN_PUBLIC_KEYS', adminKp.publicKey())
        vi.resetModules()

        const testDir = join(tmpdir(), `admin-routes-test-${Date.now()}`)
        mkdirSync(testDir, { recursive: true })
        testDbPath = join(testDir, 'test.db')
        process.env.DB_PATH = testDbPath

        const { portfolioRouter } = await import('../api/routes.js')
        app = express()
        app.use(express.json())
        app.set('trust proxy', 1)
        app.use('/api', portfolioRouter)
    })

    afterAll(() => {
        vi.unstubAllEnvs()
        if (existsSync(testDbPath)) {
            try { rmSync(testDbPath, { force: true }) } catch { /* ignore */ }
        }
        delete process.env.DB_PATH
    })

    // ── GET /api/admin/assets ─────────────────────────────────────────────────

    describe('GET /api/admin/assets', () => {
        it('returns 401 without admin headers', async () => {
            const res = await request(app).get('/api/admin/assets')
            expect(res.status).toBe(401)
        })

        it('returns 403 for a key not in ADMIN_PUBLIC_KEYS', async () => {
            const res = await request(app)
                .get('/api/admin/assets')
                .set(makeAdminHeaders(nonAdminKp))
            expect(res.status).toBe(403)
        })

        it('returns 200 for a valid admin key', async () => {
            const res = await request(app)
                .get('/api/admin/assets')
                .set(makeAdminHeaders(adminKp))
            expect(res.status).toBe(200)
            expect(res.body.data.assets).toBeDefined()
        })
    })

    // ── GET /api/admin/rate-limits/metrics ────────────────────────────────────

    describe('GET /api/admin/rate-limits/metrics', () => {
        it('returns 401 without admin headers', async () => {
            const res = await request(app).get('/api/admin/rate-limits/metrics')
            expect(res.status).toBe(401)
        })

        it('returns 403 for a key not in ADMIN_PUBLIC_KEYS', async () => {
            const res = await request(app)
                .get('/api/admin/rate-limits/metrics')
                .set(makeAdminHeaders(nonAdminKp))
            expect(res.status).toBe(403)
        })

        it('returns 200 for a valid admin key', async () => {
            const res = await request(app)
                .get('/api/admin/rate-limits/metrics')
                .set(makeAdminHeaders(adminKp))
            expect(res.status).toBe(200)
            expect(res.body.data.metrics).toBeDefined()
        })
    })

    // ── POST /api/admin/assets ────────────────────────────────────────────────

    describe('POST /api/admin/assets', () => {
        it('returns 401 without admin headers', async () => {
            const res = await request(app)
                .post('/api/admin/assets')
                .send({ symbol: 'TST', name: 'Test' })
            expect(res.status).toBe(401)
        })

        it('returns 403 for a key not in ADMIN_PUBLIC_KEYS', async () => {
            const res = await request(app)
                .post('/api/admin/assets')
                .set(makeAdminHeaders(nonAdminKp))
                .send({ symbol: 'TST', name: 'Test' })
            expect(res.status).toBe(403)
        })

        it('passes auth check for a valid admin key', async () => {
            const res = await request(app)
                .post('/api/admin/assets')
                .set({ ...makeAdminHeaders(adminKp), 'Idempotency-Key': `admin-add-${Date.now()}` })
                .send({ symbol: 'ADMTEST', name: 'Admin Test Asset' })
            expect([201, 400, 409]).toContain(res.status) // auth passed, business logic decides outcome
        })
    })

    // ── DELETE /api/admin/assets/:symbol ─────────────────────────────────────

    describe('DELETE /api/admin/assets/:symbol', () => {
        it('returns 401 without admin headers', async () => {
            const res = await request(app).delete('/api/admin/assets/ADMTEST')
            expect(res.status).toBe(401)
        })

        it('returns 403 for a key not in ADMIN_PUBLIC_KEYS', async () => {
            const res = await request(app)
                .delete('/api/admin/assets/ADMTEST')
                .set(makeAdminHeaders(nonAdminKp))
            expect(res.status).toBe(403)
        })

        it('passes auth check for a valid admin key', async () => {
            const res = await request(app)
                .delete('/api/admin/assets/ADMTEST')
                .set(makeAdminHeaders(adminKp))
            expect([200, 404]).toContain(res.status) // auth passed, business logic decides outcome
        })
    })

    // ── PATCH /api/admin/assets/:symbol ──────────────────────────────────────

    describe('PATCH /api/admin/assets/:symbol', () => {
        it('returns 401 without admin headers', async () => {
            const res = await request(app)
                .patch('/api/admin/assets/XLM')
                .send({ enabled: true })
            expect(res.status).toBe(401)
        })

        it('returns 403 for a key not in ADMIN_PUBLIC_KEYS', async () => {
            const res = await request(app)
                .patch('/api/admin/assets/XLM')
                .set(makeAdminHeaders(nonAdminKp))
                .send({ enabled: true })
            expect(res.status).toBe(403)
        })

        it('passes auth check for a valid admin key', async () => {
            const res = await request(app)
                .patch('/api/admin/assets/XLM')
                .set({ ...makeAdminHeaders(adminKp), 'Idempotency-Key': `admin-patch-${Date.now()}` })
                .send({ enabled: true })
            expect([200, 404]).toContain(res.status) // auth passed, business logic decides outcome
        })
    })
})
