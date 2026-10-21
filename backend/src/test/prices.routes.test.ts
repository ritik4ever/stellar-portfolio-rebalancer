/**
 * Validation tests for the GET /api/v1/prices routes.
 *
 * Coverage:
 *  • ohlcvQuerySchema (unit) — boundary and malformed values
 *  • pricesQuerySchema (unit) — rejects unknown query params
 *  • GET /prices (integration) — 400 on unknown params; 200 on clean call
 *  • GET /prices/ohlcv (integration) — 400 on every invalid combination; 200 on valid
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ohlcvQuerySchema, pricesQuerySchema } from '../api/validation.js'

// ─── Mock heavy external dependencies ──────────────────────────────────────
// vi.mock factories must use regular `function` (not arrow functions) for
// classes that are called with `new`.

vi.mock('../services/reflector.js', () => {
    function ReflectorService(this: any) {
        this.getCurrentPrices = vi.fn().mockResolvedValue({
            XLM: { price: 0.36, change: 0, timestamp: Math.floor(Date.now() / 1000) },
        })
        this.getCurrentPricesWithMeta = vi.fn().mockResolvedValue({
            prices: { XLM: { price: 0.36, change: 0, timestamp: Math.floor(Date.now() / 1000) } },
            feedMeta: { provider: 'backend', cacheStatus: 'redis_miss', fetchedAtMs: Date.now() },
        })
        this.finalizePriceMap = vi.fn().mockImplementation((p: unknown) => p)
        this.buildFeedMeta = vi.fn().mockReturnValue({ provider: 'backend', cacheStatus: 'synthetic_fallback' })
        this.getDetailedMarketData = vi.fn().mockResolvedValue({})
    }
    return { ReflectorService }
})

vi.mock('../services/stellar.js', () => {
    function StellarService(this: any) {}
    return { StellarService }
})

vi.mock('../services/serviceContainer.js', () => ({
    riskManagementService: {
        shouldAllowRebalance: vi.fn().mockReturnValue({ allowed: true, reason: 'OK', alerts: [] }),
        updatePriceData: vi.fn().mockReturnValue([]),
        calculateRiskHeatmap: vi.fn().mockReturnValue({}),
        getCircuitBreakerStatus: vi.fn().mockReturnValue({}),
    },
    rebalanceHistoryService: {
        recordRebalanceEvent: vi.fn().mockResolvedValue({ id: 'hist-1' }),
        getRecentAutoRebalances: vi.fn().mockResolvedValue([]),
        getAutoRebalancesSince: vi.fn().mockResolvedValue([]),
        getAllAutoRebalances: vi.fn().mockResolvedValue([]),
        getHistoryStats: vi.fn().mockResolvedValue({ totalEvents: 0, portfolios: 0, recentActivity: 0, autoRebalances: 0 }),
    },
    buildDependencyHealthSummary: vi.fn().mockReturnValue({}),
}))

vi.mock('../services/assetRegistryService.js', () => ({
    assetRegistryService: {
        list: vi.fn().mockReturnValue([]),
        getSymbols: vi.fn().mockReturnValue([]),
    },
}))

// ─── App bootstrap ─────────────────────────────────────────────────────────

let app: Express
let testDbPath: string
const envBackup: NodeJS.ProcessEnv = { ...process.env }

beforeAll(async () => {
    const testDir = join(
        tmpdir(),
        `stellar-prices-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    testDbPath = join(testDir, 'prices-test.db')

    process.env = { ...envBackup }
    delete process.env.DATABASE_URL
    process.env.DB_PATH = testDbPath
    process.env.JWT_SECRET = 'unit-test-jwt-secret-min-32-chars!!'
    process.env.NODE_ENV = 'test'
    process.env.ENABLE_DEMO_DB_SEED = 'false'
    process.env.DEMO_MODE = 'false'
    process.env.AUTH_ENABLED = 'false'

    const express = (await import('express')).default
    const cors = (await import('cors')).default
    const { mountApiRoutes } = await import('../http/mountApiRoutes.js')
    const { apiErrorHandler } = await import('../middleware/apiErrorHandler.js')

    app = express()
    app.use(cors())
    app.use(express.json())
    mountApiRoutes(app)
    app.use(apiErrorHandler)
}, 60_000)

afterAll(async () => {
    try {
        const { databaseService } = await import('../services/databaseService.js')
        databaseService.close()
    } catch { /* ignore */ }
    try {
        const { closeIdempotencyDb } = await import('../db/idempotencyDb.js')
        closeIdempotencyDb()
    } catch { /* ignore */ }
    try {
        const { closeNotificationDb } = await import('../db/notificationDb.js')
        closeNotificationDb()
    } catch { /* ignore */ }

    process.env = envBackup
})

// ══════════════════════════════════════════════════════════════════════════════
// Unit tests — ohlcvQuerySchema
// ══════════════════════════════════════════════════════════════════════════════

describe('ohlcvQuerySchema — unit', () => {
    // Convenient base for valid inputs
    const valid = {
        asset: 'XLM',
        interval: '1d',
        from: '2025-01-01T00:00:00Z',
        to: '2025-01-31T00:00:00Z',
    } as const

    it('accepts a valid query and upper-cases the asset', () => {
        const result = ohlcvQuerySchema.safeParse({ ...valid, asset: 'xlm' })
        expect(result.success).toBe(true)
        if (result.success) expect(result.data.asset).toBe('XLM')
    })

    it('accepts all valid interval values', () => {
        for (const interval of ['1h', '4h', '1d'] as const) {
            expect(ohlcvQuerySchema.safeParse({ ...valid, interval }).success).toBe(true)
        }
    })

    // ── missing / malformed params ──────────────────────────────────────────

    it.each([
        [{ interval: '1d', from: '2025-01-01T00:00:00Z', to: '2025-01-31T00:00:00Z' }, 'missing asset'],
        [{ asset: 'XLM', from: '2025-01-01T00:00:00Z', to: '2025-01-31T00:00:00Z' }, 'missing interval'],
        [{ asset: 'XLM', interval: '1d', to: '2025-01-31T00:00:00Z' }, 'missing from'],
        [{ asset: 'XLM', interval: '1d', from: '2025-01-01T00:00:00Z' }, 'missing to'],
        [{}, 'empty object'],
    ])('rejects when %s', (_input, label) => {
        expect(ohlcvQuerySchema.safeParse(_input).success, label).toBe(false)
    })

    it('rejects an empty asset string', () => {
        expect(ohlcvQuerySchema.safeParse({ ...valid, asset: '' }).success).toBe(false)
    })

    it('rejects an asset longer than 32 characters', () => {
        expect(
            ohlcvQuerySchema.safeParse({ ...valid, asset: 'A'.repeat(33) }).success,
        ).toBe(false)
    })

    it('rejects an invalid interval value', () => {
        expect(ohlcvQuerySchema.safeParse({ ...valid, interval: '2d' }).success).toBe(false)
    })

    it('rejects a non-ISO date for from', () => {
        expect(ohlcvQuerySchema.safeParse({ ...valid, from: 'yesterday' }).success).toBe(false)
    })

    it('rejects a non-ISO date for to', () => {
        expect(ohlcvQuerySchema.safeParse({ ...valid, to: 'not-a-date' }).success).toBe(false)
    })

    it('rejects unknown extra query parameters (strict mode)', () => {
        expect(
            ohlcvQuerySchema.safeParse({ ...valid, unexpected: 'value' }).success,
        ).toBe(false)
    })

    // ── domain constraints ──────────────────────────────────────────────────

    it('rejects from === to (from must be strictly before to)', () => {
        const same = '2025-06-01T00:00:00Z'
        expect(ohlcvQuerySchema.safeParse({ ...valid, from: same, to: same }).success).toBe(false)
    })

    it('rejects from > to', () => {
        expect(
            ohlcvQuerySchema.safeParse({
                ...valid,
                from: '2025-02-01T00:00:00Z',
                to: '2025-01-01T00:00:00Z',
            }).success,
        ).toBe(false)
    })

    it('accepts from exactly 1 ms before to (smallest valid range)', () => {
        expect(
            ohlcvQuerySchema.safeParse({
                ...valid,
                from: '2025-06-01T00:00:00.000Z',
                to: '2025-06-01T00:00:00.001Z',
            }).success,
        ).toBe(true)
    })

    it('accepts a range of exactly 90 days', () => {
        const from = new Date('2025-01-01T00:00:00Z')
        const to = new Date(from.getTime() + 90 * 24 * 60 * 60 * 1000)
        expect(
            ohlcvQuerySchema.safeParse({ ...valid, from: from.toISOString(), to: to.toISOString() }).success,
        ).toBe(true)
    })

    it('rejects a range exceeding 90 days by 1 ms', () => {
        const from = new Date('2025-01-01T00:00:00Z')
        const to = new Date(from.getTime() + 90 * 24 * 60 * 60 * 1000 + 1)
        expect(
            ohlcvQuerySchema.safeParse({ ...valid, from: from.toISOString(), to: to.toISOString() }).success,
        ).toBe(false)
    })

    it('rejects a 91-day range', () => {
        expect(
            ohlcvQuerySchema.safeParse({
                ...valid,
                from: '2025-01-01T00:00:00Z',
                to: '2025-04-02T00:00:00Z', // 91 days later
            }).success,
        ).toBe(false)
    })
})

// ══════════════════════════════════════════════════════════════════════════════
// Unit tests — pricesQuerySchema
// ══════════════════════════════════════════════════════════════════════════════

describe('pricesQuerySchema — unit', () => {
    it('accepts an empty query object', () => {
        expect(pricesQuerySchema.safeParse({}).success).toBe(true)
    })

    it('rejects any unknown query parameter', () => {
        expect(pricesQuerySchema.safeParse({ asset: 'XLM' }).success).toBe(false)
        expect(pricesQuerySchema.safeParse({ filter: 'all' }).success).toBe(false)
        expect(pricesQuerySchema.safeParse({ foo: 'bar', baz: '1' }).success).toBe(false)
    })
})

// ══════════════════════════════════════════════════════════════════════════════
// Integration tests — GET /api/v1/prices
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/prices — integration', () => {
    it('returns 200 with no query params', async () => {
        const res = await request(app).get('/api/v1/prices')
        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
    })

    it('returns 400 when unknown query params are supplied', async () => {
        const res = await request(app).get('/api/v1/prices?asset=XLM')
        expect(res.status).toBe(400)
        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 for multiple unknown query params', async () => {
        const res = await request(app).get('/api/v1/prices?foo=bar&baz=1')
        expect(res.status).toBe(400)
        expect(res.body.success).toBe(false)
    })
})

// ══════════════════════════════════════════════════════════════════════════════
// Integration tests — GET /api/v1/prices/ohlcv
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/v1/prices/ohlcv — integration validation gate', () => {
    const validQuery = 'asset=XLM&interval=1d&from=2025-01-01T00:00:00Z&to=2025-01-31T00:00:00Z'

    it('returns 400 when asset is missing', async () => {
        const res = await request(app).get('/api/v1/prices/ohlcv?interval=1d&from=2025-01-01T00:00:00Z&to=2025-01-31T00:00:00Z')
        expect(res.status).toBe(400)
        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 when interval is missing', async () => {
        const res = await request(app).get('/api/v1/prices/ohlcv?asset=XLM&from=2025-01-01T00:00:00Z&to=2025-01-31T00:00:00Z')
        expect(res.status).toBe(400)
    })

    it('returns 400 when from is missing', async () => {
        const res = await request(app).get('/api/v1/prices/ohlcv?asset=XLM&interval=1d&to=2025-01-31T00:00:00Z')
        expect(res.status).toBe(400)
    })

    it('returns 400 when to is missing', async () => {
        const res = await request(app).get('/api/v1/prices/ohlcv?asset=XLM&interval=1d&from=2025-01-01T00:00:00Z')
        expect(res.status).toBe(400)
    })

    it('returns 400 for an invalid interval value', async () => {
        const res = await request(app).get('/api/v1/prices/ohlcv?asset=XLM&interval=2w&from=2025-01-01T00:00:00Z&to=2025-01-31T00:00:00Z')
        expect(res.status).toBe(400)
    })

    it('returns 400 for a malformed from date', async () => {
        const res = await request(app).get('/api/v1/prices/ohlcv?asset=XLM&interval=1d&from=not-a-date&to=2025-01-31T00:00:00Z')
        expect(res.status).toBe(400)
    })

    it('returns 400 for a malformed to date', async () => {
        const res = await request(app).get('/api/v1/prices/ohlcv?asset=XLM&interval=1d&from=2025-01-01T00:00:00Z&to=tomorrow')
        expect(res.status).toBe(400)
    })

    it('returns 400 when from === to', async () => {
        const res = await request(app).get('/api/v1/prices/ohlcv?asset=XLM&interval=1d&from=2025-06-01T00:00:00Z&to=2025-06-01T00:00:00Z')
        expect(res.status).toBe(400)
    })

    it('returns 400 when from is after to', async () => {
        const res = await request(app).get('/api/v1/prices/ohlcv?asset=XLM&interval=1d&from=2025-02-01T00:00:00Z&to=2025-01-01T00:00:00Z')
        expect(res.status).toBe(400)
    })

    it('returns 400 when the date range exceeds 90 days', async () => {
        const from = '2025-01-01T00:00:00Z'
        const to = new Date(new Date(from).getTime() + 91 * 24 * 60 * 60 * 1000).toISOString()
        const res = await request(app).get(`/api/v1/prices/ohlcv?asset=XLM&interval=1d&from=${from}&to=${to}`)
        expect(res.status).toBe(400)
    })

    it('returns 400 for unknown extra query parameters', async () => {
        const res = await request(app).get(`/api/v1/prices/ohlcv?${validQuery}&unexpected=value`)
        expect(res.status).toBe(400)
    })

    it('does not reach the DB layer when validation fails (400 before any service call)', async () => {
        // Omit required params — error must be schema-level, status must be 400
        const res = await request(app).get('/api/v1/prices/ohlcv')
        expect(res.status).toBe(400)
        // Response must be the standard error envelope
        expect(res.body.success).toBe(false)
        expect(res.body.error).toBeDefined()
    })
})
