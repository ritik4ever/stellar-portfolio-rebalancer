import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import express, { Express } from 'express'
import request from 'supertest'
import { Keypair } from '@stellar/stellar-sdk'
import { adminRouter } from '../api/admin.routes.js'
import { analyticsService } from '../services/analyticsService.js'

vi.mock('../services/analyticsService', () => ({
    analyticsService: {
        compactAnalyticsForPortfolio: vi.fn(),
        compactAllPortfolios: vi.fn(),
    },
}))

vi.mock('../services/databaseService', () => ({
    databaseService: {
        recordAdminAuditEntry: vi.fn(),
    },
}))

function makeAdminHeaders(kp: Keypair) {
    const msg = Date.now().toString()
    const sig = kp.sign(Buffer.from(msg, 'utf8')).toString('base64')
    return {
        'x-public-key': kp.publicKey(),
        'x-message': msg,
        'x-signature': sig,
    }
}

describe('Admin Analytics Retention & Compaction Endpoints', () => {
    let app: Express
    let adminKp: Keypair
    let nonAdminKp: Keypair
    let originalAdminKeys: string | undefined

    beforeAll(() => {
        originalAdminKeys = process.env.ADMIN_PUBLIC_KEYS
        adminKp = Keypair.random()
        nonAdminKp = Keypair.random()
        process.env.ADMIN_PUBLIC_KEYS = adminKp.publicKey()

        app = express()
        app.use(express.json())
        app.use('/admin', adminRouter)
    })

    afterAll(() => {
        if (originalAdminKeys === undefined) {
            delete process.env.ADMIN_PUBLIC_KEYS
        } else {
            process.env.ADMIN_PUBLIC_KEYS = originalAdminKeys
        }
    })

    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('GET /admin/analytics/retention-policy', () => {
        it('requires admin credentials', async () => {
            const res = await request(app).get('/admin/analytics/retention-policy')
            expect(res.status).toBe(401)
        })

        it('returns current configured retention policy, defaults, and limits', async () => {
            const res = await request(app)
                .get('/admin/analytics/retention-policy')
                .set(makeAdminHeaders(adminKp))

            expect(res.status).toBe(200)
            expect(res.body.success).toBe(true)
            expect(res.body.data.retentionPolicy).toEqual({
                cutoffDays: 90,
                recentDays: 7,
                defaults: {
                    cutoffDays: 90,
                    recentDays: 7,
                },
                limits: {
                    minCutoffDays: 1,
                    maxCutoffDays: 3650,
                    minRecentDays: 1,
                    maxRecentDays: 365,
                },
            })
        })
    })

    describe('POST /admin/analytics/compact', () => {
        it('requires admin credentials', async () => {
            const res = await request(app)
                .post('/admin/analytics/compact')
                .send({ cutoffDays: 60, recentDays: 7 })

            expect(res.status).toBe(401)
        })

        it('triggers compaction for all portfolios with default settings when portfolioId is undefined', async () => {
            vi.mocked(analyticsService.compactAllPortfolios).mockResolvedValue([
                {
                    portfolioId: 'p1',
                    deletedCount: 15,
                    retainedCount: 45,
                    compactionCutoffTimestamp: new Date().toISOString(),
                },
            ])

            const res = await request(app)
                .post('/admin/analytics/compact')
                .set(makeAdminHeaders(adminKp))
                .send({})

            expect(res.status).toBe(200)
            expect(res.body.success).toBe(true)
            expect(vi.mocked(analyticsService.compactAllPortfolios)).toHaveBeenCalledWith(90, 7)
            expect(res.body.data.summary.totalSnapshotsDeleted).toBe(15)
            expect(res.body.data.summary.totalSnapshotsRetained).toBe(45)
        })

        it('triggers compaction for a specific portfolio with custom retention overrides', async () => {
            vi.mocked(analyticsService.compactAnalyticsForPortfolio).mockResolvedValue({
                portfolioId: 'target-p1',
                deletedCount: 50,
                retainedCount: 20,
                compactionCutoffTimestamp: new Date().toISOString(),
            })

            const res = await request(app)
                .post('/admin/analytics/compact')
                .set(makeAdminHeaders(adminKp))
                .send({
                    portfolioId: 'target-p1',
                    cutoffDays: 45,
                    recentDays: 5,
                })

            expect(res.status).toBe(200)
            expect(res.body.success).toBe(true)
            expect(vi.mocked(analyticsService.compactAnalyticsForPortfolio)).toHaveBeenCalledWith(
                'target-p1',
                45,
                5,
            )
            expect(res.body.data.stats.deletedCount).toBe(50)
        })

        it('rejects invalid empty or non-string portfolioId when provided instead of falling back to all portfolios', async () => {
            const emptyRes = await request(app)
                .post('/admin/analytics/compact')
                .set(makeAdminHeaders(adminKp))
                .send({
                    portfolioId: '',
                })

            expect(emptyRes.status).toBe(400)
            expect(emptyRes.body.success).toBe(false)
            expect(emptyRes.body.error.code).toBe('VALIDATION_ERROR')
            expect(emptyRes.body.error.message).toContain('portfolioId must be a non-empty string')
            expect(vi.mocked(analyticsService.compactAllPortfolios)).not.toHaveBeenCalled()

            const nullRes = await request(app)
                .post('/admin/analytics/compact')
                .set(makeAdminHeaders(adminKp))
                .send({
                    portfolioId: null,
                })

            expect(nullRes.status).toBe(400)
            expect(nullRes.body.success).toBe(false)
            expect(nullRes.body.error.code).toBe('VALIDATION_ERROR')
            expect(vi.mocked(analyticsService.compactAllPortfolios)).not.toHaveBeenCalled()
        })

        it('rejects fractional cutoffDays (e.g. 1.9)', async () => {
            const res = await request(app)
                .post('/admin/analytics/compact')
                .set(makeAdminHeaders(adminKp))
                .send({
                    cutoffDays: 1.9,
                })

            expect(res.status).toBe(400)
            expect(res.body.success).toBe(false)
            expect(res.body.error.code).toBe('VALIDATION_ERROR')
        })

        it('rejects string with text suffix for cutoffDays (e.g. "90days")', async () => {
            const res = await request(app)
                .post('/admin/analytics/compact')
                .set(makeAdminHeaders(adminKp))
                .send({
                    cutoffDays: '90days',
                })

            expect(res.status).toBe(400)
            expect(res.body.success).toBe(false)
            expect(res.body.error.code).toBe('VALIDATION_ERROR')
        })

        it('rejects fractional or suffixed recentDays (e.g. 3.5 or "7days")', async () => {
            const fractionalRes = await request(app)
                .post('/admin/analytics/compact')
                .set(makeAdminHeaders(adminKp))
                .send({
                    recentDays: 3.5,
                })

            expect(fractionalRes.status).toBe(400)
            expect(fractionalRes.body.success).toBe(false)
            expect(fractionalRes.body.error.code).toBe('VALIDATION_ERROR')

            const suffixedRes = await request(app)
                .post('/admin/analytics/compact')
                .set(makeAdminHeaders(adminKp))
                .send({
                    recentDays: '7days',
                })

            expect(suffixedRes.status).toBe(400)
            expect(suffixedRes.body.success).toBe(false)
            expect(suffixedRes.body.error.code).toBe('VALIDATION_ERROR')
        })

        it('rejects unsupported JSON types such as boolean, array, or object for cutoffDays and recentDays', async () => {
            const boolCutoffRes = await request(app)
                .post('/admin/analytics/compact')
                .set(makeAdminHeaders(adminKp))
                .send({
                    cutoffDays: true,
                })

            expect(boolCutoffRes.status).toBe(400)
            expect(boolCutoffRes.body.success).toBe(false)
            expect(boolCutoffRes.body.error.code).toBe('VALIDATION_ERROR')

            const arrayRecentRes = await request(app)
                .post('/admin/analytics/compact')
                .set(makeAdminHeaders(adminKp))
                .send({
                    cutoffDays: 90,
                    recentDays: [7],
                })

            expect(arrayRecentRes.status).toBe(400)
            expect(arrayRecentRes.body.success).toBe(false)
            expect(arrayRecentRes.body.error.code).toBe('VALIDATION_ERROR')

            const objectCutoffRes = await request(app)
                .post('/admin/analytics/compact')
                .set(makeAdminHeaders(adminKp))
                .send({
                    cutoffDays: { days: 90 },
                })

            expect(objectCutoffRes.status).toBe(400)
            expect(objectCutoffRes.body.success).toBe(false)
            expect(objectCutoffRes.body.error.code).toBe('VALIDATION_ERROR')
        })

        it('rejects invalid cutoffDays out of range', async () => {
            const res = await request(app)
                .post('/admin/analytics/compact')
                .set(makeAdminHeaders(adminKp))
                .send({
                    cutoffDays: -1,
                })

            expect(res.status).toBe(400)
            expect(res.body.success).toBe(false)
            expect(res.body.error.code).toBe('VALIDATION_ERROR')
        })

        it('rejects when cutoffDays < recentDays', async () => {
            const res = await request(app)
                .post('/admin/analytics/compact')
                .set(makeAdminHeaders(adminKp))
                .send({
                    cutoffDays: 5,
                    recentDays: 10,
                })

            expect(res.status).toBe(400)
            expect(res.body.success).toBe(false)
            expect(res.body.error.message).toContain('must be >= recentDays')
        })
    })
})

