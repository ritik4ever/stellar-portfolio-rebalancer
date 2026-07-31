import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import express from 'express'
import type { Express } from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('../utils/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
    }
}))

// The price feed is stubbed so the endpoint's own cost is what gets measured,
// and so `getCurrentPrices` call counts are a direct check that the route does
// one price lookup for the whole page rather than one per portfolio.
const { getCurrentPrices } = vi.hoisted(() => ({
    getCurrentPrices: vi.fn(async () => ({
        XLM: { price: 0.5, change: 0, timestamp: 0 },
        USDC: { price: 1, change: 0, timestamp: 0 }
    }))
}))

vi.mock('../services/reflector.js', () => ({
    ReflectorService: class {
        getCurrentPrices = getCurrentPrices
        getCurrentPricesWithMeta = vi.fn(async () => ({
            prices: await getCurrentPrices(),
            feedMeta: {}
        }))
    }
}))

const OWNER_ADDRESS = 'GSUMMARYOWNER123456789ABCDEF'
const OTHER_ADDRESS = 'GSUMMARYOTHER123456789ABCDEF'
const UNKNOWN_ADDRESS = 'GSUMMARYNOBODY123456789ABCDE'
const JWT_SECRET = 'test-jwt-secret-for-summary-tests-min-32!!'

const SUMMARY_PATH = '/api/portfolios/summary'

let app: Express
let testDbPath: string
let portfolioStorage: any

async function createApp(): Promise<Express> {
    const app = express()
    app.use(express.json())
    app.set('trust proxy', 1)

    const { portfoliosRouter } = await import('../api/portfolios.routes.js') as any
    app.use('/api', portfoliosRouter)

    return app
}

/** Seed one portfolio and return its id. */
function seedPortfolio(
    userAddress: string,
    allocations: Record<string, number>,
    balances: Record<string, number>,
    threshold = 5
): string {
    return portfolioStorage.createPortfolioWithBalances(userAddress, allocations, threshold, balances)
}

beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    delete process.env.JWT_SECRET

    const testDir = join(tmpdir(), `stellar-summary-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    testDbPath = join(testDir, 'test.db')
    process.env.DB_PATH = testDbPath

    const dbModule = await import('../services/databaseService.js') as any
    portfolioStorage = dbModule.databaseService

    app = await createApp()
})

afterAll(() => {
    if (existsSync(testDbPath)) {
        try { rmSync(testDbPath, { force: true }) } catch { /* temp file */ }
    }
    delete process.env.DB_PATH
    delete process.env.JWT_SECRET
})

beforeEach(() => {
    getCurrentPrices.mockClear()
})

describe('GET /portfolios/summary', () => {
    it('returns an empty array for an address with no portfolios', async () => {
        const res = await request(app).get(SUMMARY_PATH).query({ userAddress: UNKNOWN_ADDRESS })

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data.portfolios).toEqual([])
    })

    it('does not touch the price feed when the address has no portfolios', async () => {
        await request(app).get(SUMMARY_PATH).query({ userAddress: UNKNOWN_ADDRESS })

        expect(getCurrentPrices).not.toHaveBeenCalled()
    })

    it('rejects a request with no userAddress', async () => {
        const res = await request(app).get(SUMMARY_PATH)

        expect(res.status).toBe(422)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns the documented fields for each portfolio', async () => {
        const address = `${OWNER_ADDRESS}-FIELDS`
        const id = seedPortfolio(address, { XLM: 50, USDC: 50 }, { XLM: 100, USDC: 50 })
        portfolioStorage.updatePortfolio(id, { name: 'Core holdings' }, 1)

        const res = await request(app).get(SUMMARY_PATH).query({ userAddress: address })

        expect(res.status).toBe(200)
        expect(res.body.data.portfolios).toHaveLength(1)

        const summary = res.body.data.portfolios[0]
        expect(Object.keys(summary).sort()).toEqual([
            'drift_status',
            'id',
            'last_rebalanced',
            'name',
            'total_value_usd'
        ])
        expect(summary.id).toBe(id)
        expect(summary.name).toBe('Core holdings')
        expect(summary.total_value_usd).toBe(100)
        expect(summary.drift_status).toBe('ok')
        expect(typeof summary.last_rebalanced).toBe('string')
    })

    it('reports a null name for a portfolio that was never named', async () => {
        const address = `${OWNER_ADDRESS}-UNNAMED`
        seedPortfolio(address, { XLM: 100 }, { XLM: 100 })

        const res = await request(app).get(SUMMARY_PATH).query({ userAddress: address })

        expect(res.body.data.portfolios[0].name).toBeNull()
    })

    it('classifies drift as ok, warning, and critical from real balances', async () => {
        const address = `${OWNER_ADDRESS}-DRIFT`
        // Priced at XLM $0.50 / USDC $1.00 against a 50/50 target and a 5% threshold.
        seedPortfolio(address, { XLM: 50, USDC: 50 }, { XLM: 100, USDC: 50 })   // 50/50  -> 0pp
        seedPortfolio(address, { XLM: 50, USDC: 50 }, { XLM: 106, USDC: 47 })   // 53/47  -> 3pp
        seedPortfolio(address, { XLM: 50, USDC: 50 }, { XLM: 160, USDC: 20 })   // 80/20  -> 30pp

        const res = await request(app).get(SUMMARY_PATH).query({ userAddress: address })

        const statuses = res.body.data.portfolios.map((p: any) => p.drift_status)
        expect(statuses.sort()).toEqual(['critical', 'ok', 'warning'])
    })

    it('values a portfolio holding an asset with no price at zero for that asset', async () => {
        const address = `${OWNER_ADDRESS}-UNPRICED`
        seedPortfolio(address, { XLM: 50, NOPRICE: 50 }, { XLM: 100, NOPRICE: 999 })

        const res = await request(app).get(SUMMARY_PATH).query({ userAddress: address })

        expect(res.body.data.portfolios[0].total_value_usd).toBe(50)
    })

    it('returns only the requested address\'s portfolios', async () => {
        const mine = `${OWNER_ADDRESS}-SCOPED`
        const theirs = `${OTHER_ADDRESS}-SCOPED`
        seedPortfolio(mine, { XLM: 100 }, { XLM: 10 })
        seedPortfolio(theirs, { XLM: 100 }, { XLM: 10 })

        const res = await request(app).get(SUMMARY_PATH).query({ userAddress: mine })

        expect(res.body.data.portfolios).toHaveLength(1)
    })
})

describe('GET /portfolios/summary — one request instead of N', () => {
    const address = `${OWNER_ADDRESS}-TEN`

    beforeAll(() => {
        for (let i = 0; i < 10; i++) {
            seedPortfolio(address, { XLM: 50, USDC: 50 }, { XLM: 100 + i * 4, USDC: 50 - i })
        }
    })

    it('resolves prices once for ten portfolios', async () => {
        const res = await request(app).get(SUMMARY_PATH).query({ userAddress: address })

        expect(res.body.data.portfolios).toHaveLength(10)
        expect(getCurrentPrices).toHaveBeenCalledTimes(1)
    })

    it('answers within the 300ms budget for ten portfolios', async () => {
        // Warm up first so the measurement reflects steady-state serving rather
        // than one-off statement preparation on a cold sqlite handle.
        await request(app).get(SUMMARY_PATH).query({ userAddress: address })

        const startedAt = performance.now()
        const res = await request(app).get(SUMMARY_PATH).query({ userAddress: address })
        const elapsedMs = performance.now() - startedAt

        expect(res.status).toBe(200)
        expect(res.body.data.portfolios).toHaveLength(10)
        expect(elapsedMs).toBeLessThan(300)
    })
})

describe('GET /portfolios/summary — ownership', () => {
    const address = `${OWNER_ADDRESS}-AUTH`

    beforeAll(() => {
        seedPortfolio(address, { XLM: 100 }, { XLM: 10 })
        process.env.JWT_SECRET = JWT_SECRET
    })

    afterAll(() => {
        delete process.env.JWT_SECRET
    })

    function authHeader(forAddress: string): Record<string, string> {
        const token = jwt.sign({ sub: forAddress, type: 'access' }, JWT_SECRET, { expiresIn: '15m' })
        return { Authorization: `Bearer ${token}` }
    }

    it('rejects an unauthenticated request when auth is enabled', async () => {
        const res = await request(app).get(SUMMARY_PATH).query({ userAddress: address })

        expect(res.status).toBe(401)
    })

    it('rejects a caller asking for someone else\'s portfolios', async () => {
        const res = await request(app)
            .get(SUMMARY_PATH)
            .query({ userAddress: address })
            .set(authHeader(OTHER_ADDRESS))

        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('FORBIDDEN')
    })

    it('serves the owner their own portfolios', async () => {
        const res = await request(app)
            .get(SUMMARY_PATH)
            .query({ userAddress: address })
            .set(authHeader(address))

        expect(res.status).toBe(200)
        expect(res.body.data.portfolios).toHaveLength(1)
    })
})
