/**
 * Manual issuer-verification workflow for unlisted assets (#1412).
 *
 * Covers the full lifecycle — user submission, admin approval, admin rejection —
 * at the service layer and through the HTTP endpoints.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    logAudit: vi.fn(),
}))

vi.mock('../config/featureFlags.js', () => ({
    getFeatureFlags: () => ({ enableIssuerMetadata: false, demoMode: false }),
}))

vi.mock('../services/issuerMetadataService.js', () => ({
    issuerMetadataService: { getMetadata: vi.fn(async () => undefined) },
}))

// Minimal in-memory stand-in for the sqlite asset table.
interface StoredAsset {
    symbol: string
    name: string
    contractAddress?: string
    issuerAccount?: string
    coingeckoId?: string
    enabled: boolean
    lastRefreshedAt?: string
    isQuarantined: boolean
    verificationStatus: 'pending' | 'verified' | 'rejected'
    verificationNotes?: string
    submittedBy?: string
    reviewedBy?: string
    reviewedAt?: string
}

const assets = new Map<string, StoredAsset>()

vi.mock('../services/databaseService.js', () => ({
    databaseService: {
        getAssetBySymbol: vi.fn((symbol: string) => assets.get(symbol.toUpperCase())),
        listAssets: vi.fn((enabledOnly = true) =>
            [...assets.values()].filter(a => (enabledOnly ? a.enabled && !a.isQuarantined : true)),
        ),
        listAssetsByVerificationStatus: vi.fn((status: string) =>
            [...assets.values()].filter(a => a.verificationStatus === status),
        ),
        addAsset: vi.fn((symbol: string, name: string, options: any = {}) => {
            const status = options.verificationStatus ?? 'verified'
            assets.set(symbol.toUpperCase(), {
                symbol: symbol.toUpperCase(),
                name,
                contractAddress: options.contractAddress,
                issuerAccount: options.issuerAccount,
                coingeckoId: options.coingeckoId,
                enabled: status === 'verified',
                lastRefreshedAt: new Date().toISOString(),
                isQuarantined: false,
                verificationStatus: status,
                submittedBy: options.submittedBy,
            })
        }),
        setAssetVerification: vi.fn((symbol: string, status: any, options: any = {}) => {
            const asset = assets.get(symbol.toUpperCase())
            if (!asset) return false
            asset.verificationStatus = status
            asset.verificationNotes = options.notes
            asset.reviewedBy = options.reviewedBy
            asset.reviewedAt = new Date().toISOString()
            asset.enabled = status === 'verified'
            return true
        }),
        setAssetFreshness: vi.fn(),
        removeAsset: vi.fn(),
        setAssetEnabled: vi.fn(),
        setAssetQuarantined: vi.fn(),
        recordAdminAuditEntry: vi.fn(),
        hasFullConsent: vi.fn(() => true),
    },
}))

vi.mock('../middleware/auth.js', () => ({
    requireAdmin: (req: any, _res: any, next: any) => {
        req.adminPublicKey = 'GADMINPUBLICKEY'
        next()
    },
}))

vi.mock('../middleware/requireJwt.js', () => ({
    requireJwt: (req: any, _res: any, next: any) => {
        req.user = { address: 'GSUBMITTERADDRESS' }
        next()
    },
    requireJwtWhenEnabled: (req: any, _res: any, next: any) => next(),
}))

vi.mock('../middleware/idempotency.js', () => ({
    idempotencyMiddleware: (_req: any, _res: any, next: any) => next(),
}))

vi.mock('../middleware/rateLimit.js', () => ({
    adminRateLimiter: (_req: any, _res: any, next: any) => next(),
    protectedWriteLimiter: [(_req: any, _res: any, next: any) => next()],
}))

vi.mock('../queue/workers/priceHistoryWorker.js', () => ({
    schedulePriceHistoryBackfill: vi.fn(),
}))

vi.mock('../services/rateLimitMonitor.js', () => ({
    rateLimitMonitor: { getRateLimitDashboard: vi.fn(() => ({})) },
}))

// A real (randomly generated) Stellar public key — the registry validates the checksum.
const ISSUER = 'GALS2LSWO2CEUPXWM6KV47SHRPY4GCHW4BXZWJTIPV2SBW2MVSGCVLPA'

function seedVerifiedAsset(symbol: string) {
    assets.set(symbol, {
        symbol,
        name: `${symbol} token`,
        enabled: true,
        isQuarantined: false,
        verificationStatus: 'verified',
        lastRefreshedAt: new Date().toISOString(),
    })
}

async function makeApp() {
    const { assetsRouter } = await import('../api/assets.routes.js')
    const app = express()
    app.use(express.json())
    app.use('/api', assetsRouter)
    return app
}

describe('issuer verification workflow (#1412)', () => {
    beforeEach(() => {
        assets.clear()
        vi.clearAllMocks()
    })

    describe('submission', () => {
        it('creates the asset as pending and disabled', async () => {
            const { assetRegistryService } = await import('../services/assetRegistryService.js')

            const asset = await assetRegistryService.submitForVerification('NEWT', 'New Token', {
                issuerAccount: ISSUER,
                submittedBy: 'GSUBMITTERADDRESS',
            })

            expect(asset).toMatchObject({
                symbol: 'NEWT',
                verificationStatus: 'pending',
                enabled: false,
                submittedBy: 'GSUBMITTERADDRESS',
            })
        })

        it('keeps pending assets out of the enabled catalog', async () => {
            const { assetRegistryService } = await import('../services/assetRegistryService.js')
            seedVerifiedAsset('XLM')

            await assetRegistryService.submitForVerification('NEWT', 'New Token', { issuerAccount: ISSUER })

            expect(assetRegistryService.getSymbols(true)).toEqual(['XLM'])
            expect(assetRegistryService.list(false).map(a => a.symbol).sort()).toEqual(['NEWT', 'XLM'])
        })

        it('rejects a duplicate symbol', async () => {
            const { assetRegistryService } = await import('../services/assetRegistryService.js')
            const { AssetRegistryConflictError } = await import('../services/assetRegistryValidation.js')
            seedVerifiedAsset('XLM')

            await expect(
                assetRegistryService.submitForVerification('XLM', 'Duplicate', {}),
            ).rejects.toBeInstanceOf(AssetRegistryConflictError)
        })
    })

    describe('admin decisions', () => {
        it('approves a pending asset, enabling it and recording the reviewer', async () => {
            const { assetRegistryService } = await import('../services/assetRegistryService.js')
            await assetRegistryService.submitForVerification('NEWT', 'New Token', { issuerAccount: ISSUER })

            const approved = assetRegistryService.approveVerification('NEWT', 'GADMIN', 'domain verified')

            expect(approved).toMatchObject({
                verificationStatus: 'verified',
                enabled: true,
                reviewedBy: 'GADMIN',
                verificationNotes: 'domain verified',
            })
            expect(approved.reviewedAt).toBeTruthy()
            expect(assetRegistryService.getSymbols(true)).toContain('NEWT')
        })

        it('rejects a pending asset, leaving it disabled', async () => {
            const { assetRegistryService } = await import('../services/assetRegistryService.js')
            await assetRegistryService.submitForVerification('BADT', 'Bad Token', { issuerAccount: ISSUER })

            const rejected = assetRegistryService.rejectVerification('BADT', 'GADMIN', 'unknown issuer domain')

            expect(rejected).toMatchObject({
                verificationStatus: 'rejected',
                enabled: false,
                verificationNotes: 'unknown issuer domain',
            })
            expect(assetRegistryService.getSymbols(true)).not.toContain('BADT')
        })

        it('lists only pending submissions for review', async () => {
            const { assetRegistryService } = await import('../services/assetRegistryService.js')
            seedVerifiedAsset('XLM')
            await assetRegistryService.submitForVerification('AAA', 'A Token', {})
            await assetRegistryService.submitForVerification('BBB', 'B Token', {})
            assetRegistryService.approveVerification('AAA', 'GADMIN')

            const pending = assetRegistryService.listPendingVerifications()

            expect(pending.map(a => a.symbol)).toEqual(['BBB'])
        })

        it('refuses to decide twice on the same submission', async () => {
            const { assetRegistryService, AssetVerificationError } = await import('../services/assetRegistryService.js')
            await assetRegistryService.submitForVerification('NEWT', 'New Token', {})
            assetRegistryService.approveVerification('NEWT', 'GADMIN')

            expect(() => assetRegistryService.rejectVerification('NEWT', 'GADMIN')).toThrow(AssetVerificationError)
            expect(() => assetRegistryService.approveVerification('NEWT', 'GADMIN')).toThrow(/already verified/)
        })

        it('refuses a decision on an unknown symbol', async () => {
            const { assetRegistryService } = await import('../services/assetRegistryService.js')

            expect(() => assetRegistryService.approveVerification('GHOST', 'GADMIN')).toThrow(/not found/)
        })
    })

    describe('existing assets', () => {
        it('treats assets predating the workflow as verified', async () => {
            const { assetRegistryService } = await import('../services/assetRegistryService.js')
            assets.set('OLD', {
                symbol: 'OLD',
                name: 'Legacy',
                enabled: true,
                isQuarantined: false,
                lastRefreshedAt: new Date().toISOString(),
            } as StoredAsset)

            expect(assetRegistryService.getBySymbol('OLD')?.verificationStatus).toBe('verified')
        })
    })

    describe('HTTP endpoints', () => {
        it('POST /assets/submissions creates a pending submission', async () => {
            const app = await makeApp()

            const res = await request(app)
                .post('/api/assets/submissions')
                .send({ symbol: 'NEWT', name: 'New Token', issuerAccount: ISSUER })

            expect(res.status).toBe(201)
            expect(res.body.data.asset).toMatchObject({
                symbol: 'NEWT',
                verificationStatus: 'pending',
                enabled: false,
                submittedBy: 'GSUBMITTERADDRESS',
            })
        })

        it('POST /assets/submissions rejects a duplicate with 409', async () => {
            const app = await makeApp()
            seedVerifiedAsset('XLM')

            const res = await request(app)
                .post('/api/assets/submissions')
                .send({ symbol: 'XLM', name: 'Duplicate' })

            expect(res.status).toBe(409)
            expect(res.body.success).toBe(false)
        })

        it('GET /admin/assets/submissions lists pending submissions', async () => {
            const app = await makeApp()
            await request(app).post('/api/assets/submissions').send({ symbol: 'NEWT', name: 'New Token' })

            const res = await request(app).get('/api/admin/assets/submissions')

            expect(res.status).toBe(200)
            expect(res.body.data.count).toBe(1)
            expect(res.body.data.submissions[0].symbol).toBe('NEWT')
        })

        it('POST /admin/assets/:symbol/verification approves a submission', async () => {
            const app = await makeApp()
            await request(app).post('/api/assets/submissions').send({ symbol: 'NEWT', name: 'New Token' })

            const res = await request(app)
                .post('/api/admin/assets/NEWT/verification')
                .send({ decision: 'approve', notes: 'looks good' })

            expect(res.status).toBe(200)
            expect(res.body.data.asset).toMatchObject({
                verificationStatus: 'verified',
                enabled: true,
                reviewedBy: 'GADMINPUBLICKEY',
                verificationNotes: 'looks good',
            })
        })

        it('POST /admin/assets/:symbol/verification rejects a submission', async () => {
            const app = await makeApp()
            await request(app).post('/api/assets/submissions').send({ symbol: 'BADT', name: 'Bad Token' })

            const res = await request(app)
                .post('/api/admin/assets/BADT/verification')
                .send({ decision: 'reject', notes: 'unverifiable issuer' })

            expect(res.status).toBe(200)
            expect(res.body.data.asset).toMatchObject({ verificationStatus: 'rejected', enabled: false })
        })

        it('returns 404 for a decision on an unknown asset', async () => {
            const app = await makeApp()

            const res = await request(app)
                .post('/api/admin/assets/GHOST/verification')
                .send({ decision: 'approve' })

            expect(res.status).toBe(404)
        })

        it('returns 409 for a second decision on the same asset', async () => {
            const app = await makeApp()
            await request(app).post('/api/assets/submissions').send({ symbol: 'NEWT', name: 'New Token' })
            await request(app).post('/api/admin/assets/NEWT/verification').send({ decision: 'approve' })

            const res = await request(app)
                .post('/api/admin/assets/NEWT/verification')
                .send({ decision: 'reject' })

            expect(res.status).toBe(409)
        })

        it('rejects an unknown decision value', async () => {
            const app = await makeApp()
            await request(app).post('/api/assets/submissions').send({ symbol: 'NEWT', name: 'New Token' })

            const res = await request(app)
                .post('/api/admin/assets/NEWT/verification')
                .send({ decision: 'maybe' })

            expect(res.status).toBe(422)
        })
    })
})
