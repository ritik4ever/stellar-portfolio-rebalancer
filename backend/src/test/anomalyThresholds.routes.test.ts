import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
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

describe('Admin anomaly thresholds API endpoints', () => {
    let app: Express
    let adminKp: Keypair
    let nonAdminKp: Keypair
    let testDbPath: string

    beforeAll(async () => {
        adminKp = Keypair.random()
        nonAdminKp = Keypair.random()
        process.env.ADMIN_PUBLIC_KEYS = adminKp.publicKey()

        const testDir = join(tmpdir(), `anomaly-thresholds-test-${Date.now()}`)
        mkdirSync(testDir, { recursive: true })
        testDbPath = join(testDir, 'test.db')
        process.env.DB_PATH = testDbPath

        const { adminRouter } = await import('../api/admin.routes.js')
        app = express()
        app.use(express.json())
        app.set('trust proxy', 1)
        app.use('/api/admin', adminRouter)
    })

    beforeEach(async () => {
        const { resetAnomalyCounts, resetAnomalyThresholds } = await import('../monitoring/anomalyTracker.js')
        resetAnomalyCounts()
        resetAnomalyThresholds()
    })

    afterAll(() => {
        delete process.env.ADMIN_PUBLIC_KEYS
        delete process.env.DB_PATH
        if (existsSync(testDbPath)) {
            try { rmSync(testDbPath, { force: true }) } catch { /* ignore */ }
        }
    })

    describe('GET /api/admin/anomaly-thresholds', () => {
        it('returns 401 without admin headers', async () => {
            const res = await request(app).get('/api/admin/anomaly-thresholds')
            expect(res.status).toBe(401)
        })

        it('returns 403 for non-admin public key', async () => {
            const res = await request(app)
                .get('/api/admin/anomaly-thresholds')
                .set(makeAdminHeaders(nonAdminKp))
            expect(res.status).toBe(403)
        })

        it('returns 200 with thresholds and summary for valid admin key', async () => {
            const res = await request(app)
                .get('/api/admin/anomaly-thresholds')
                .set(makeAdminHeaders(adminKp))

            expect(res.status).toBe(200)
            expect(res.body.success).toBe(true)
            expect(res.body.data.thresholds).toBeDefined()
            expect(res.body.data.thresholds.rebalanceBlocks).toBeGreaterThan(0)
            expect(res.body.data.summary).toBeDefined()
        })
    })

    describe('PUT /api/admin/anomaly-thresholds', () => {
        it('returns 401 without admin headers', async () => {
            const res = await request(app)
                .put('/api/admin/anomaly-thresholds')
                .send({ rebalanceBlocks: 10 })
            expect(res.status).toBe(401)
        })

        it('returns 403 for non-admin key', async () => {
            const res = await request(app)
                .put('/api/admin/anomaly-thresholds')
                .set(makeAdminHeaders(nonAdminKp))
                .send({ rebalanceBlocks: 10 })
            expect(res.status).toBe(403)
        })

        it('returns 400 VALIDATION_ERROR for negative threshold values', async () => {
            const res = await request(app)
                .put('/api/admin/anomaly-thresholds')
                .set(makeAdminHeaders(adminKp))
                .send({ rebalanceBlocks: -1 })

            expect(res.status).toBe(400)
            expect(res.body.error.code).toBe('VALIDATION_ERROR')
        })

        it('returns 400 VALIDATION_ERROR for invalid field key', async () => {
            const res = await request(app)
                .put('/api/admin/anomaly-thresholds')
                .set(makeAdminHeaders(adminKp))
                .send({ unknownField: 5 })

            expect(res.status).toBe(400)
            expect(res.body.error.code).toBe('VALIDATION_ERROR')
        })

        it('returns 400 VALIDATION_ERROR for non-numeric value', async () => {
            const res = await request(app)
                .put('/api/admin/anomaly-thresholds')
                .set(makeAdminHeaders(adminKp))
                .send({ rebalanceBlocks: 'five' })

            expect(res.status).toBe(400)
            expect(res.body.error.code).toBe('VALIDATION_ERROR')
        })


        it('updates thresholds successfully for valid admin key', async () => {
            const res = await request(app)
                .put('/api/admin/anomaly-thresholds')
                .set(makeAdminHeaders(adminKp))
                .send({ rebalanceBlocks: 2, criticalRiskAlerts: 1 })

            expect(res.status).toBe(200)
            expect(res.body.success).toBe(true)
            expect(res.body.data.thresholds.rebalanceBlocks).toBe(2)
            expect(res.body.data.thresholds.criticalRiskAlerts).toBe(1)

            // Confirm GET endpoint returns the updated threshold values
            const getRes = await request(app)
                .get('/api/admin/anomaly-thresholds')
                .set(makeAdminHeaders(adminKp))

            expect(getRes.status).toBe(200)
            expect(getRes.body.data.thresholds.rebalanceBlocks).toBe(2)
        })
    })
})
