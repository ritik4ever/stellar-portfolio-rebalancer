import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import type { Express } from 'express'
import request from 'supertest'
import { getMarketMoversData } from '../db/priceHistoryDb.js'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { databaseService } from '../services/databaseService.js'
import { closeIdempotencyDb } from '../db/idempotencyDb.js'
import { closeNotificationDb } from '../db/notificationDb.js'

vi.mock('../db/priceHistoryDb.js', () => ({
    getMarketMoversData: vi.fn(),
}))

vi.mock('../services/assetRegistryService.js', () => ({
    assetRegistryService: {
        list: vi.fn().mockReturnValue([
            { symbol: 'XLM', name: 'Stellar Lumens', enabled: true },
            { symbol: 'BTC', name: 'Bitcoin', enabled: true },
            { symbol: 'ETH', name: 'Ethereum', enabled: true },
            { symbol: 'USDC', name: 'USD Coin', enabled: true },
            { symbol: 'MOVER5', name: 'Mover 5', enabled: true },
            { symbol: 'MOVER6', name: 'Mover 6', enabled: true },
            { symbol: 'MOVER7', name: 'Mover 7', enabled: true },
            { symbol: 'MOVER8', name: 'Mover 8', enabled: true },
        ]),
        getSymbols: vi.fn().mockReturnValue(['XLM', 'BTC', 'ETH', 'USDC', 'MOVER5', 'MOVER6', 'MOVER7', 'MOVER8']),
    }
}))

let app: Express
let testDbPath: string
const envBackup: NodeJS.ProcessEnv = { ...process.env }

beforeAll(async () => {
    const testDir = join(tmpdir(), `stellar-market-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    testDbPath = join(testDir, 'market-test.db')

    vi.resetModules()
    process.env = { ...envBackup }
    delete process.env.DATABASE_URL
    process.env.DB_PATH = testDbPath
    process.env.JWT_SECRET = 'unit-test-jwt-secret-min-32-chars!!'
    process.env.NODE_ENV = 'test'
    process.env.ENABLE_DEMO_DB_SEED = 'false'
    process.env.DEMO_MODE = 'true'
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
    } catch {}
    try {
        const { closeIdempotencyDb } = await import('../db/idempotencyDb.js')
        closeIdempotencyDb()
    } catch {}
    try {
        const { closeNotificationDb } = await import('../db/notificationDb.js')
        closeNotificationDb()
    } catch {}
    
    vi.unstubAllEnvs()
    process.env = envBackup
    if (testDbPath) {
        const dir = join(testDbPath, '..')
        try {
            if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
        } catch {}
    }
})

describe('market routes integration', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('GET /api/v1/market/movers returns top 5 gainers and losers sorted correctly', async () => {
        const mockMovers = [
            { asset: 'XLM', price: 0.12, change24h: 20 },      // Gainer 1
            { asset: 'BTC', price: 60000, change24h: -5 },     // Loser 1
            { asset: 'ETH', price: 3000, change24h: 0 },       // Flat (neither)
            { asset: 'USDC', price: 1.0, change24h: 1 },       // Gainer 4
            { asset: 'MOVER5', price: 5.0, change24h: 15 },    // Gainer 2
            { symbol: 'MOVER6', asset: 'MOVER6', price: 6.0, change24h: 10 },    // Gainer 3
            { asset: 'MOVER7', price: 7.0, change24h: -10 },   // Loser 2
            { asset: 'MOVER8', price: 8.0, change24h: -15 },   // Loser 3
        ]

        const getMarketMoversDataMock = vi.mocked(getMarketMoversData)
        getMarketMoversDataMock.mockResolvedValueOnce(mockMovers)

        const res = await request(app).get('/api/v1/market/movers').expect(200)

        expect(res.body.success).toBe(true)
        expect(res.body.data).toBeDefined()
        
        const { gainers, losers } = res.body.data
        
        // Assert gainers (should have positive change and sorted desc, up to 5)
        expect(gainers).toHaveLength(4)
        expect(gainers[0].symbol).toBe('XLM') // +20%
        expect(gainers[1].symbol).toBe('MOVER5') // +15%
        expect(gainers[2].symbol).toBe('MOVER6') // +10%
        expect(gainers[3].symbol).toBe('USDC') // +1%

        // Assert losers (should have negative change and sorted asc, up to 5)
        expect(losers).toHaveLength(3)
        expect(losers[0].symbol).toBe('MOVER8') // -15%
        expect(losers[1].symbol).toBe('MOVER7') // -10%
        expect(losers[2].symbol).toBe('BTC') // -5%
    })

    it('returns empty lists if no movers are found', async () => {
        const getMarketMoversDataMock = vi.mocked(getMarketMoversData)
        getMarketMoversDataMock.mockResolvedValueOnce([])

        const res = await request(app).get('/api/v1/market/movers').expect(200)

        expect(res.body.success).toBe(true)
        expect(res.body.data.gainers).toEqual([])
        expect(res.body.data.losers).toEqual([])
    })
})
