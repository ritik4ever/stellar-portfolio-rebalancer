import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import express, { Express } from 'express'
import request from 'supertest'
import { Keypair } from '@stellar/stellar-sdk'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { issuerMetadataService } from '../services/issuerMetadataService.js'

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
    }, 60000)




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

        it('creates an asset with issuer metadata if issuerAccount is provided', async () => {
            const mockMetadata = {
                org_name: 'Stellar Foundation',
                org_description: 'Stellar test network asset',
                org_url: 'https://stellar.org'
            }
            const getMetadataSpy = vi
                .spyOn(issuerMetadataService, 'getMetadata')
                .mockResolvedValue(mockMetadata)

            const symbol = 'META'
            const res = await request(app)
                .post('/api/admin/assets')
                .set({ ...makeAdminHeaders(adminKp), 'Idempotency-Key': `admin-add-meta-${Date.now()}` })
                .send({
                    symbol,
                    name: 'Metadata Asset',
                    issuerAccount: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
                })

            expect(res.status).toBe(201)
            expect(getMetadataSpy).toHaveBeenCalledWith('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5')
            expect(res.body.success).toBe(true)
            expect(res.body.data.asset.issuerMetadata).toEqual(mockMetadata)
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

    // ── POST /api/admin/db/explain ─────────────────────────────────────────────

    describe('POST /api/admin/db/explain', () => {
        it('returns 401 without admin headers', async () => {
            const res = await request(app)
                .post('/api/admin/db/explain')
                .send({ queryId: 'get_all_portfolios' })
            expect(res.status).toBe(401)
        })

        it('returns 403 for a key not in ADMIN_PUBLIC_KEYS', async () => {
            const res = await request(app)
                .post('/api/admin/db/explain')
                .set(makeAdminHeaders(nonAdminKp))
                .send({ queryId: 'get_all_portfolios' })
            expect(res.status).toBe(403)
        })

        it('returns 400 for missing queryId', async () => {
            const res = await request(app)
                .post('/api/admin/db/explain')
                .set(makeAdminHeaders(adminKp))
                .send({})
            expect(res.status).toBe(400)
            expect(res.body.error).toBe('VALIDATION_ERROR')
        })

        it('returns 400 for invalid queryId', async () => {
            const res = await request(app)
                .post('/api/admin/db/explain')
                .set(makeAdminHeaders(adminKp))
                .send({ queryId: 'invalid_query' })
            expect(res.status).toBe(400)
            expect(res.body.error).toBe('VALIDATION_ERROR')
        })

        it('returns 200 with explain plan for valid admin and queryId', async () => {
            const res = await request(app)
                .post('/api/admin/db/explain')
                .set(makeAdminHeaders(adminKp))
                .send({ queryId: 'get_portfolio_count' })
            expect(res.status).toBe(200)
            expect(res.body.success).toBe(true)
            expect(res.body.data.queryId).toBe('get_portfolio_count')
            expect(res.body.data.explainPlan).toBeDefined()
            expect(res.body.data.explainExecutionTimeMs).toBeDefined()
            expect(res.body.data.queryExecutionTimeMs).toBeDefined()
        })

        it('includes estimated and actual row counts in response', async () => {
            const res = await request(app)
                .post('/api/admin/db/explain')
                .set(makeAdminHeaders(adminKp))
                .send({ queryId: 'get_all_portfolios' })
            expect(res.status).toBe(200)
            expect(res.body.data.estimatedRows).toBeDefined()
            expect(res.body.data.actualRows).toBeDefined()
            expect(res.body.data.rowCount).toBeDefined()
        })

        it('handles parameterized queries', async () => {
            const res = await request(app)
                .post('/api/admin/db/explain')
                .set(makeAdminHeaders(adminKp))
                .send({ queryId: 'get_portfolio_by_id', params: ['test-id'] })
            expect(res.status).toBe(200)
            expect(res.body.data.queryId).toBe('get_portfolio_by_id')
        })
    })

    // ── GET /api/admin/db/queries ─────────────────────────────────────────────

    describe('GET /api/admin/db/queries', () => {
        it('returns 401 without admin headers', async () => {
            const res = await request(app).get('/api/admin/db/queries')
            expect(res.status).toBe(401)
        })

        it('returns 403 for a key not in ADMIN_PUBLIC_KEYS', async () => {
            const res = await request(app)
                .get('/api/admin/db/queries')
                .set(makeAdminHeaders(nonAdminKp))
            expect(res.status).toBe(403)
        })

        it('returns 200 with list of available queries for valid admin', async () => {
            const res = await request(app)
                .get('/api/admin/db/queries')
                .set(makeAdminHeaders(adminKp))
            expect(res.status).toBe(200)
            expect(res.body.success).toBe(true)
            expect(res.body.data.queries).toBeDefined()
            expect(Array.isArray(res.body.data.queries)).toBe(true)
            expect(res.body.data.queries.length).toBeGreaterThan(0)
            expect(res.body.data.queries[0]).toHaveProperty('id')
            expect(res.body.data.queries[0]).toHaveProperty('query')
        })
    })

    // ── Issuer metadata cache endpoints (TTL + stale-serve + refresh) ─────────

    const META_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'

    describe('GET /api/admin/issuer-metadata/:issuer', () => {
        afterEach(() => { vi.restoreAllMocks() })

        it('returns 401 without admin headers', async () => {
            const res = await request(app).get(`/api/admin/issuer-metadata/${META_ISSUER}`)
            expect(res.status).toBe(401)
        })

        it('returns 403 for a key not in ADMIN_PUBLIC_KEYS', async () => {
            const res = await request(app)
                .get(`/api/admin/issuer-metadata/${META_ISSUER}`)
                .set(makeAdminHeaders(nonAdminKp))
            expect(res.status).toBe(403)
        })

        it('returns 404 when no metadata is available for the account', async () => {
            const routesSvc = (await import('../services/issuerMetadataService.js')).issuerMetadataService
            vi.spyOn(routesSvc, 'getMetadataWithStatus')
                .mockResolvedValue(undefined as never)
            const res = await request(app)
                .get(`/api/admin/issuer-metadata/${META_ISSUER}`)
                .set(makeAdminHeaders(adminKp))
            expect(res.status).toBe(404)
            expect(res.body.error.code).toBe('NOT_FOUND')
        })

        it('returns 200 with metadata and staleness flags', async () => {
            const routesSvc = (await import('../services/issuerMetadataService.js')).issuerMetadataService
            vi.spyOn(routesSvc, 'getMetadataWithStatus')
                .mockResolvedValue({
                    data: { org_name: 'Stellar Foundation' } as any,
                    stale: false,
                    fetchedAtMs: 1234,
                    expiresAtMs: 7654321,
                    source: 'network',
                })
            const res = await request(app)
                .get(`/api/admin/issuer-metadata/${META_ISSUER}`)
                .set(makeAdminHeaders(adminKp))
            expect(res.status).toBe(200)
            expect(res.body.success).toBe(true)
            expect(res.body.data.issuer).toBe(META_ISSUER)
            expect(res.body.data.stale).toBe(false)
            expect(res.body.data.source).toBe('network')
            expect(res.body.data.data.org_name).toBe('Stellar Foundation')
        })
    })

    describe('POST /api/admin/issuer-metadata/:issuer/refresh', () => {
        afterEach(() => { vi.restoreAllMocks() })

        it('returns 401 without admin headers', async () => {
            const res = await request(app).post(`/api/admin/issuer-metadata/${META_ISSUER}/refresh`)
            expect(res.status).toBe(401)
        })

        it('returns 403 for a key not in ADMIN_PUBLIC_KEYS', async () => {
            const res = await request(app)
                .post(`/api/admin/issuer-metadata/${META_ISSUER}/refresh`)
                .set(makeAdminHeaders(nonAdminKp))
            expect(res.status).toBe(403)
        })

        it('returns 200 with refreshed metadata for a valid admin', async () => {
            const routesSvc = (await import('../services/issuerMetadataService.js')).issuerMetadataService
            const forceRefreshSpy = vi.spyOn(routesSvc, 'forceRefreshMetadata')
                .mockResolvedValue({
                    data: { org_name: 'Refreshed Org' } as any,
                    stale: false,
                    fetchedAtMs: 99,
                    expiresAtMs: 123456,
                    source: 'network',
                })
            const res = await request(app)
                .post(`/api/admin/issuer-metadata/${META_ISSUER}/refresh`)
                .set(makeAdminHeaders(adminKp))
            expect(res.status).toBe(200)
            expect(forceRefreshSpy).toHaveBeenCalledWith(META_ISSUER)
            expect(res.body.success).toBe(true)
            expect(res.body.data.stale).toBe(false)
            expect(res.body.data.source).toBe('network')
            expect(res.body.data.data.org_name).toBe('Refreshed Org')
        })

        it('signals stale data in the response when the upstream refetch fails', async () => {
            const routesSvc = (await import('../services/issuerMetadataService.js')).issuerMetadataService
            vi.spyOn(routesSvc, 'forceRefreshMetadata')
                .mockResolvedValue({
                    data: { org_name: 'Stale Org' } as any,
                    stale: true,
                    fetchedAtMs: 1,
                    expiresAtMs: 2,
                    source: 'stale',
                })
            const res = await request(app)
                .post(`/api/admin/issuer-metadata/${META_ISSUER}/refresh`)
                .set(makeAdminHeaders(adminKp))
            expect(res.status).toBe(200)
            expect(res.body.data.stale).toBe(true)
            expect(res.body.data.source).toBe('stale')
            expect(res.body.data.data.org_name).toBe('Stale Org')
        })

        it('returns 502 when the refresh fails with nothing cached to serve', async () => {
            const routesSvc = (await import('../services/issuerMetadataService.js')).issuerMetadataService
            vi.spyOn(routesSvc, 'forceRefreshMetadata')
                .mockRejectedValue(new Error('TOML host unreachable'))
            const res = await request(app)
                .post(`/api/admin/issuer-metadata/${META_ISSUER}/refresh`)
                .set(makeAdminHeaders(adminKp))
            expect(res.status).toBe(502)
            expect(res.body.error.code).toBe('UPSTREAM_ERROR')
        })
    })

    // ── GET/PUT /api/admin/config/volatility-threshold (#1386) ─────────────

    describe('GET/PUT /api/admin/config/volatility-threshold', () => {
        beforeEach(async () => {
            const { databaseService } = await import('../services/databaseService.js')
            const { VOLATILITY_THRESHOLD_KV_KEY } = await import('../config/volatilityConfig.js')
            databaseService.deleteKvValue(VOLATILITY_THRESHOLD_KV_KEY)
        })

        it('GET returns 401 without admin headers', async () => {
            const res = await request(app).get('/api/admin/config/volatility-threshold')
            expect(res.status).toBe(401)
        })

        it('GET returns 403 for a key not in ADMIN_PUBLIC_KEYS', async () => {
            const res = await request(app)
                .get('/api/admin/config/volatility-threshold')
                .set(makeAdminHeaders(nonAdminKp))
            expect(res.status).toBe(403)
        })

        it('GET returns the default threshold with min/max bounds for a valid admin', async () => {
            const res = await request(app)
                .get('/api/admin/config/volatility-threshold')
                .set(makeAdminHeaders(adminKp))
            expect(res.status).toBe(200)
            expect(res.body.data.thresholdPct).toBe(15)
            expect(res.body.data.min).toBe(1)
            expect(res.body.data.max).toBe(50)
        })

        it('PUT updates the threshold and GET reports the persisted value', async () => {
            const putRes = await request(app)
                .put('/api/admin/config/volatility-threshold')
                .set(makeAdminHeaders(adminKp))
                .send({ threshold: 25 })
            expect(putRes.status).toBe(200)
            expect(putRes.body.data.thresholdPct).toBe(25)

            const getRes = await request(app)
                .get('/api/admin/config/volatility-threshold')
                .set(makeAdminHeaders(adminKp))
            expect(getRes.status).toBe(200)
            expect(getRes.body.data.thresholdPct).toBe(25)
        })

        it('PUT accepts thresholdPct as the body field', async () => {
            const putRes = await request(app)
                .put('/api/admin/config/volatility-threshold')
                .set(makeAdminHeaders(adminKp))
                .send({ thresholdPct: 30 })
            expect(putRes.status).toBe(200)
            expect(putRes.body.data.thresholdPct).toBe(30)
        })

        it('PUT rejects thresholds below the 1% minimum', async () => {
            const putRes = await request(app)
                .put('/api/admin/config/volatility-threshold')
                .set(makeAdminHeaders(adminKp))
                .send({ threshold: 0.5 })
            expect(putRes.status).toBe(400)
            expect(putRes.body.error.code).toBe('VALIDATION_ERROR')
        })

        it('PUT rejects thresholds above the 50% maximum', async () => {
            const putRes = await request(app)
                .put('/api/admin/config/volatility-threshold')
                .set(makeAdminHeaders(adminKp))
                .send({ threshold: 51 })
            expect(putRes.status).toBe(400)
            expect(putRes.body.error.code).toBe('VALIDATION_ERROR')
        })

        it('PUT rejects a non-numeric threshold', async () => {
            const putRes = await request(app)
                .put('/api/admin/config/volatility-threshold')
                .set(makeAdminHeaders(adminKp))
                .send({ threshold: 'twenty' })
            expect(putRes.status).toBe(400)
            expect(putRes.body.error.code).toBe('VALIDATION_ERROR')
        })
    })
})
