/**
 * SPR-2026-190 — API error serialization edge cases.
 *
 * The error envelope (`backend/src/utils/apiResponse.ts`) is the only thing a
 * client sees when a request fails, so it has to behave predictably:
 *
 *  - the same class of failure always yields the same `error.code`,
 *  - the body never carries credentials that came from an upstream failure,
 *  - a failed request performs no side effect twice (one response write, one
 *    idempotency record, one lookup per dependency).
 *
 * Every dependency is replaced by an isolated double: no SQLite file, no
 * Postgres pool, no Redis, no Stellar RPC and no outbound HTTP. The suites
 * below are therefore deterministic and offline.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import express from 'express'
import type { Express } from 'express'
import request from 'supertest'

const {
    getAssetBySymbol,
    setAssetFreshness,
    listAssets,
    getPortfolio,
    stellarGetPortfolio,
    reflectorGetCurrentPrices,
    captureException,
    dbGetIdempotencyResult,
    dbStoreIdempotencyResult,
    redisGetIdempotencyResult,
    redisStoreIdempotencyResult
} = vi.hoisted(() => ({
    getAssetBySymbol: vi.fn(),
    setAssetFreshness: vi.fn(),
    listAssets: vi.fn(() => []),
    getPortfolio: vi.fn(),
    stellarGetPortfolio: vi.fn(),
    reflectorGetCurrentPrices: vi.fn(),
    captureException: vi.fn(),
    dbGetIdempotencyResult: vi.fn(),
    dbStoreIdempotencyResult: vi.fn(),
    redisGetIdempotencyResult: vi.fn(async () => undefined),
    redisStoreIdempotencyResult: vi.fn(async () => undefined)
}))

// ── isolated DB / RPC / oracle doubles ───────────────────────────────────────
vi.mock('../services/databaseService.js', () => ({
    databaseService: {
        getAssetBySymbol,
        setAssetFreshness,
        listAssets,
        getPortfolio,
        getReadiness: () => ({ status: 'healthy' })
    }
}))

vi.mock('../services/stellar.js', () => ({
    StellarService: class {
        getPortfolio = stellarGetPortfolio
        estimateRebalanceGas = vi.fn()
        executeRebalance = vi.fn()
    }
}))

vi.mock('../services/reflector.js', () => ({
    ReflectorService: class {
        getCurrentPrices = reflectorGetCurrentPrices
        getCurrentPricesWithMeta = vi.fn(async () => ({ prices: {}, feedMeta: {} }))
        testOracleReachability = vi.fn(async () => ({ reachable: true }))
    }
}))

vi.mock('../observability/sentry.js', () => ({
    captureException
}))

vi.mock('../db/idempotencyDb.js', () => ({
    dbGetIdempotencyResult,
    dbStoreIdempotencyResult,
    dbCleanupExpiredIdempotencyKeys: vi.fn(),
    closeIdempotencyDb: vi.fn()
}))

vi.mock('../services/idempotencyRedisStore.js', () => ({
    redisGetIdempotencyResult,
    redisStoreIdempotencyResult
}))

// ── fixtures ─────────────────────────────────────────────────────────────────
/** A well-formed Stellar secret key (S + 55 base32 characters). */
const STELLAR_SECRET = `S${'A'.repeat(55)}`

/** An upstream failure whose message carries credentials. */
const UPSTREAM_CREDENTIAL_MESSAGE = [
    "Failed to get asset 'XLM': Error: connect ECONNREFUSED 10.0.0.5:5432",
    'password=hunter2secret',
    'api_key=cg-abcdefghijklmnop',
    `secret=${STELLAR_SECRET}`
].join(' ')

/** The literal credential values that must never reach the client. */
const CREDENTIAL_VALUES = ['hunter2secret', 'cg-abcdefghijklmnop', STELLAR_SECRET]

/** Malformed-but-non-blank asset ids; every one must serialize identically. */
const MALFORMED_ASSET_IDS = [
    'not-a-valid-symbol',
    '%2E%2E%2F%2E%2E%2Fetc%2Fpasswd',
    `x${'y'.repeat(300)}`,
    'XLM%3BDROP%20TABLE%20assets'
]

const UNKNOWN_PORTFOLIO_ID = 'portfolio-that-does-not-exist'

let app: Express
let jsonWriteCount = 0

beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    process.env.AUTH_ENABLED = 'false'
    delete process.env.ADMIN_PUBLIC_KEYS

    const { assetsRouter } = await import('../api/assets.routes.js')
    const { portfoliosRouter } = await import('../api/portfolios.routes.js')
    const { idempotencyMiddleware } = await import('../middleware/idempotency.js')
    const { apiErrorHandler } = await import('../middleware/apiErrorHandler.js')
    const { fail } = await import('../utils/apiResponse.js')

    app = express()
    app.use(express.json())

    // Count how many times a response body is written: a double write means
    // the error path ran twice.
    app.use((_req, res, next) => {
        const originalJson = res.json.bind(res)
        res.json = ((body: unknown) => {
            jsonWriteCount += 1
            return originalJson(body)
        }) as typeof res.json
        next()
    })

    app.use('/api/v1', assetsRouter)
    app.use('/api/v1', portfoliosRouter)

    // An endpoint whose upstream dependency rejects: the rejection escapes the
    // route handler and is serialized by the global error handler.
    app.get('/api/v1/__test__/upstream-failure', async () => {
        throw new Error(UPSTREAM_CREDENTIAL_MESSAGE)
    })

    // A write endpoint guarded by the idempotency middleware so the number of
    // stored idempotency records can be asserted.
    app.post('/api/v1/__test__/idempotent/:id', idempotencyMiddleware, (_req, res) => {
        fail(res, 404, 'NOT_FOUND', 'Portfolio not found')
    })

    app.use(apiErrorHandler)
}, 60_000)

afterAll(() => {
    vi.unstubAllEnvs()
})

beforeEach(() => {
    jsonWriteCount = 0
    getAssetBySymbol.mockReset()
    setAssetFreshness.mockReset()
    getPortfolio.mockReset()
    stellarGetPortfolio.mockReset()
    reflectorGetCurrentPrices.mockReset()
    captureException.mockReset()
    dbGetIdempotencyResult.mockReset()
    dbStoreIdempotencyResult.mockReset()
    redisGetIdempotencyResult.mockClear()
    redisStoreIdempotencyResult.mockClear()

    // Defaults: an empty registry, no portfolio anywhere, a healthy oracle.
    getAssetBySymbol.mockReturnValue(undefined)
    getPortfolio.mockReturnValue(undefined)
    stellarGetPortfolio.mockResolvedValue(null)
    reflectorGetCurrentPrices.mockResolvedValue({})
})

describe('malformed asset ids', () => {
    it('rejects a blank asset id with VALIDATION_ERROR and never queries the registry', async () => {
        const res = await request(app).get('/api/v1/assets/%20').expect(400)

        expect(res.body.success).toBe(false)
        expect(res.body.data).toBeNull()
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
        expect(res.body.error.message).toBe('Asset id is required')
        expect(getAssetBySymbol).not.toHaveBeenCalled()
    })

    it('serializes every malformed asset id shape with the same NOT_FOUND code', async () => {
        for (const assetId of MALFORMED_ASSET_IDS) {
            const res = await request(app).get(`/api/v1/assets/${assetId}`).expect(404)

            expect(res.body.success).toBe(false)
            expect(res.body.data).toBeNull()
            expect(res.body.error.code).toBe('NOT_FOUND')
            expect(res.body.error.message).toBe('Asset not found')
        }
    })

    it('looks a malformed asset id up exactly once', async () => {
        await request(app).get('/api/v1/assets/not-a-valid-symbol').expect(404)

        expect(getAssetBySymbol).toHaveBeenCalledTimes(1)
        expect(getAssetBySymbol).toHaveBeenCalledWith('not-a-valid-symbol')
    })

    it('does not write freshness or quarantine state for an unknown asset', async () => {
        await request(app).get('/api/v1/assets/DOES_NOT_EXIST').expect(404)

        expect(setAssetFreshness).not.toHaveBeenCalled()
    })
})

describe('unknown portfolio ids', () => {
    it('serializes an unknown portfolio id with NOT_FOUND', async () => {
        const res = await request(app).get(`/api/v1/portfolio/${UNKNOWN_PORTFOLIO_ID}`).expect(404)

        expect(res.body.success).toBe(false)
        expect(res.body.data).toBeNull()
        expect(res.body.error.code).toBe('NOT_FOUND')
        expect(res.body.error.message).toBe('Portfolio not found')
    })

    it('does not repeat the lookup when the portfolio does not exist', async () => {
        await request(app).get(`/api/v1/portfolio/${UNKNOWN_PORTFOLIO_ID}`).expect(404)

        expect(stellarGetPortfolio).toHaveBeenCalledTimes(1)
        expect(getPortfolio).not.toHaveBeenCalled()
    })

    it('does not query the price feed for an unknown portfolio', async () => {
        await request(app).get(`/api/v1/portfolio/${UNKNOWN_PORTFOLIO_ID}`).expect(404)

        expect(reflectorGetCurrentPrices).not.toHaveBeenCalled()
    })

    it('keeps the NOT_FOUND code when the upstream lookup reports a missing portfolio', async () => {
        stellarGetPortfolio.mockRejectedValue(new Error('Portfolio not found'))

        const res = await request(app).get(`/api/v1/portfolio/${UNKNOWN_PORTFOLIO_ID}`).expect(404)

        expect(res.body.error.code).toBe('NOT_FOUND')
        expect(getPortfolio).not.toHaveBeenCalled()
    })

    it('keeps the NOT_FOUND code when the storage fallback has no portfolio either', async () => {
        stellarGetPortfolio.mockRejectedValue(new Error('upstream unavailable'))
        getPortfolio.mockReturnValue(undefined)

        const res = await request(app).get(`/api/v1/portfolio/${UNKNOWN_PORTFOLIO_ID}`).expect(404)

        expect(res.body.error.code).toBe('NOT_FOUND')
        expect(stellarGetPortfolio).toHaveBeenCalledTimes(1)
        expect(getPortfolio).toHaveBeenCalledTimes(1)
    })
})

describe('upstream exception carrying credentials', () => {
    it('serializes a route level upstream failure as INTERNAL_ERROR without the credential', async () => {
        getAssetBySymbol.mockImplementation(() => {
            throw new Error(UPSTREAM_CREDENTIAL_MESSAGE)
        })

        const res = await request(app).get('/api/v1/assets/XLM').expect(500)

        expect(res.body.success).toBe(false)
        expect(res.body.data).toBeNull()
        expect(res.body.error.code).toBe('INTERNAL_ERROR')

        const serialized = JSON.stringify(res.body)
        for (const credential of CREDENTIAL_VALUES) {
            expect(serialized).not.toContain(credential)
        }
    })

    it('redacts the credential assignment but keeps the surrounding context', async () => {
        getAssetBySymbol.mockImplementation(() => {
            throw new Error(UPSTREAM_CREDENTIAL_MESSAGE)
        })

        const res = await request(app).get('/api/v1/assets/XLM').expect(500)

        expect(res.body.error.message).toContain('[REDACTED]')
        expect(res.body.error.message).toContain('Failed to get asset')
        expect(res.body.error.message).toMatch(/password=\[REDACTED\]/i)
        expect(res.body.error.message).toMatch(/api_key=\[REDACTED\]/i)
        expect(res.body.error.message).toMatch(/secret=\[REDACTED\]/i)
    })

    it('never attaches a details payload to a server error', async () => {
        getAssetBySymbol.mockImplementation(() => {
            throw new Error(UPSTREAM_CREDENTIAL_MESSAGE)
        })

        const res = await request(app).get('/api/v1/assets/XLM').expect(500)

        expect(res.body.error.details).toBeUndefined()
    })

    it('serializes an unhandled upstream rejection with the same error code', async () => {
        const res = await request(app).get('/api/v1/__test__/upstream-failure').expect(500)

        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('INTERNAL_ERROR')

        const serialized = JSON.stringify(res.body)
        for (const credential of CREDENTIAL_VALUES) {
            expect(serialized).not.toContain(credential)
        }
    })

    it('reports the upstream failure to the error tracker exactly once', async () => {
        await request(app).get('/api/v1/__test__/upstream-failure').expect(500)

        expect(captureException).toHaveBeenCalledTimes(1)
    })

    it('does not leak stack frames into the response body', async () => {
        const error = new Error('upstream failure')
        error.stack = 'Error: upstream failure\n    at Object.<anonymous> (/srv/app/src/services/stellar.ts:266:9)'
        getAssetBySymbol.mockImplementation(() => {
            throw error
        })

        const res = await request(app).get('/api/v1/assets/XLM').expect(500)

        expect(res.body.error.message).not.toContain('/srv/app/src/')
        expect(res.body.error.message).not.toContain('at Object.<anonymous>')
    })
})

describe('duplicate side effects', () => {
    it('writes the error response exactly once for a missing asset', async () => {
        const res = await request(app).get('/api/v1/assets/DOES_NOT_EXIST').expect(404)

        expect(jsonWriteCount).toBe(1)
        expect(res.body.error.code).toBe('NOT_FOUND')
    })

    it('writes the error response exactly once when the upstream call fails', async () => {
        getAssetBySymbol.mockImplementation(() => {
            throw new Error(UPSTREAM_CREDENTIAL_MESSAGE)
        })

        await request(app).get('/api/v1/assets/XLM').expect(500)

        expect(jsonWriteCount).toBe(1)
    })

    it('writes the error response exactly once for an unknown portfolio', async () => {
        await request(app).get(`/api/v1/portfolio/${UNKNOWN_PORTFOLIO_ID}`).expect(404)

        expect(jsonWriteCount).toBe(1)
    })

    it('stores exactly one idempotency record for a failed request', async () => {
        await request(app)
            .post(`/api/v1/__test__/idempotent/${UNKNOWN_PORTFOLIO_ID}`)
            .set('Idempotency-Key', 'spr-2026-190-failure') // gitleaks:allow — test fixture, not a credential
            .expect(404)

        expect(dbStoreIdempotencyResult).toHaveBeenCalledTimes(1)
        expect(redisStoreIdempotencyResult).toHaveBeenCalledTimes(1)
        expect(jsonWriteCount).toBe(1)
    })
})
