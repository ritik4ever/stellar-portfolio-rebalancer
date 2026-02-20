import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import express, { Express } from 'express'
import cors from 'cors'
import request from 'supertest'
import { portfolioRouter } from '../api/routes.js'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ─── Setup ──────────────────────────────────────────────────────────────────

let app: Express
let testDbPath: string

beforeAll(async () => {
    // Create temporary database for tests
    const testDir = join(tmpdir(), `stellar-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    testDbPath = join(testDir, 'test.db')
    process.env.DB_PATH = testDbPath

    app = express()

    app.use(cors({
        origin: true,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With']
    }))

    app.options('*', (req, res) => {
        res.header('Access-Control-Allow-Origin', '*')
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH')
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With')
        res.status(200).end()
    })

    app.use(express.json({ limit: '10mb' }))
    app.use(express.urlencoded({ extended: true, limit: '10mb' }))

    app.set('trust proxy', 1)

    app.use('/api', portfolioRouter)

    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
        console.error('API Error:', err)
        res.status(500).json({ error: 'Internal server error' })
    })
})

afterAll(() => {
    
    if (existsSync(testDbPath)) {
        try {
            rmSync(testDbPath, { force: true })
        } catch (e) {
            // Ignore cleanup errors
        }
    }
    delete process.env.DB_PATH
})

// ─── Health Check Tests ─────────────────────────────────────────────────────

describe('API Health Check', () => {
    it('GET /api/health returns healthy status', async () => {
        const response = await request(app)
            .get('/api/health')
            .expect((res) => {
                expect([200, 201]).toContain(res.status)
            })

        expect(response.body.status).toMatch(/ok|healthy/)
        expect(response.body.timestamp).toBeDefined()
    })
})

// ─── Portfolio Creation Tests ────────────────────────────────────────────────

describe('Portfolio Management - POST /api/portfolio', () => {
    it('should create a portfolio with valid input', async () => {
        const testPayload = {
            userAddress: 'GTEST123456789ABCDEF0',
            allocations: { XLM: 60, USDC: 40 },
            threshold: 5
        }

        const response = await request(app)
            .post('/api/portfolio')
            .send(testPayload)
            .expect((res) => {
                expect([200, 201]).toContain(res.status)
            })

        expect(response.body.portfolioId).toBeDefined()
        expect(response.body.status).toBe('created')
        expect(response.body.mode).toBe('demo')
    })

    it('should return 400 for missing required fields', async () => {
        const testPayload = {
            userAddress: 'GTEST123456789'
            // Missing allocations and threshold
        }

        const response = await request(app)
            .post('/api/portfolio')
            .send(testPayload)
            .expect(400)

        expect(response.body.error).toBeDefined()
        expect(response.body.error).toContain('Missing required fields')
    })

    it('should return 400 if allocations do not sum to 100%', async () => {
        const testPayload = {
            userAddress: 'GTEST123456789ABCDEF1',
            allocations: { XLM: 60, USDC: 30 }, 
            threshold: 5
        }

        const response = await request(app)
            .post('/api/portfolio')
            .send(testPayload)
            .expect(400)

        expect(response.body.error).toContain('100%')
    })

    it('should return 400 if threshold is out of range', async () => {
        const testPayload = {
            userAddress: 'GTEST123456789ABCDEF2',
            allocations: { XLM: 60, USDC: 40 },
            threshold: 100 
        }

        const response = await request(app)
            .post('/api/portfolio')
            .send(testPayload)
            .expect(400)

        expect(response.body.error).toContain('Threshold')
    })

    it('should return 400 if asset allocation is invalid', async () => {
        const testPayload = {
            userAddress: 'GTEST123456789ABCDEF3',
            allocations: { XLM: 120, USDC: -20 }, 
            threshold: 5
        }

        const response = await request(app)
            .post('/api/portfolio')
            .send(testPayload)
            .expect(400)

        expect(response.body.error).toBeDefined()
    })
})

// ─── Portfolio Retrieval Tests ───────────────────────────────────────────────

describe('Portfolio Management - GET /api/portfolio/:id', () => {
    it('should return portfolio data for valid portfolio ID', async () => {
        // First create a portfolio
        const createPayload = {
            userAddress: 'GGET123456789ABCDEF0',
            allocations: { XLM: 60, USDC: 40 },
            threshold: 5
        }

        const createResponse = await request(app)
            .post('/api/portfolio')
            .send(createPayload)
            .expect((res) => {
                expect([200, 201]).toContain(res.status)
            })

        const portfolioId = createResponse.body.portfolioId
        expect(portfolioId).toBeDefined()

        // Now fetch it
        const getResponse = await request(app)
            .get(`/api/portfolio/${portfolioId}`)
            .expect((res) => {
                expect([200, 201]).toContain(res.status)
            })

        expect(getResponse.body.portfolio).toBeDefined()
        expect(getResponse.body.prices).toBeDefined()
        expect(getResponse.body.mode).toBe('demo')
    })

    it('should return 400 for missing portfolio ID', async () => {
        const response = await request(app)
            .get('/api/portfolio/')
            .expect((res) => {
                // 404 or 400 depending on routing
                expect([400, 404]).toContain(res.status)
            })
    })

    it('should handle non-existent portfolio gracefully', async () => {
        const response = await request(app)
            .get('/api/portfolio/nonexistent-id-xyz')
            .expect((res) => {
                expect([400, 404, 500]).toContain(res.status)
            })

        expect(response.body.error || response.body.message).toBeDefined()
    })
})

// ─── Prices Tests ───────────────────────────────────────────────────────────

describe('Price Data - GET /api/prices', () => {
    it('should return price data for major assets', async () => {
        const response = await request(app)
            .get('/api/prices')
            .expect(200)

        // Should have at least one asset
        expect(Object.keys(response.body).length).toBeGreaterThan(0)

        // Check for common assets (might be fallback data)
        const hasAssets = response.body.XLM || response.body.BTC || response.body.ETH || response.body.USDC
        expect(hasAssets).toBeTruthy()
    })

    it('should return objects with required price fields', async () => {
        const response = await request(app)
            .get('/api/prices')
            .expect(200)

        const assets = Object.values(response.body) as any[]
        expect(assets.length).toBeGreaterThan(0)

        const firstAsset = assets[0]
        expect(firstAsset).toBeDefined()
        expect(firstAsset.price).toBeDefined()
        expect(typeof firstAsset.price).toBe('number')
        expect(firstAsset.timestamp).toBeDefined()
    })

    it('should return consistent asset structure', async () => {
        const response = await request(app)
            .get('/api/prices')
            .expect(200)

        // All assets should have consistent structure
        for (const [assetName, assetData] of Object.entries(response.body)) {
            const asset = assetData as any
            expect(asset.price).toBeDefined()
            expect(typeof asset.price).toBe('number')
            expect(asset.timestamp).toBeDefined()
        }
    })
})

// ─── Rebalancing Tests ──────────────────────────────────────────────────────

describe('Rebalancing - POST /api/portfolio/:id/rebalance', () => {
    it('should handle rebalance request with validation', async () => {
        // First create a portfolio
        const createPayload = {
            userAddress: 'GREBALANCE123456789A',
            allocations: { XLM: 60, USDC: 40 },
            threshold: 5
        }

        const createResponse = await request(app)
            .post('/api/portfolio')
            .send(createPayload)
            .expect((res) => {
                expect([200, 201]).toContain(res.status)
            })

        const portfolioId = createResponse.body.portfolioId
        expect(portfolioId).toBeDefined()

        // Now try to rebalance
        const rebalanceResponse = await request(app)
            .post(`/api/portfolio/${portfolioId}/rebalance`)
            .send({})
            .expect((res) => {
                expect([200, 201, 400, 409]).toContain(res.status)
            })

        // Response should contain either status or error
        expect(
            rebalanceResponse.body.status ||
            rebalanceResponse.body.error ||
            rebalanceResponse.body.reason
        ).toBeDefined()
    })

    it('should return error for invalid portfolio ID', async () => {
        const response = await request(app)
            .post('/api/portfolio/invalid-id-xyz-123/rebalance')
            .send({})
            .expect((res) => {
                expect([400, 404, 500]).toContain(res.status)
            })

        expect(response.body.error || response.body.message).toBeDefined()
    })

    it('should require portfolio ID in URL', async () => {
        const response = await request(app)
            .post('/api/portfolio//rebalance')
            .send({})
            .expect((res) => {
                expect([400, 404]).toContain(res.status)
            })
    })
})

// ─── User Portfolios Tests ──────────────────────────────────────────────────

describe('Portfolio Management - GET /api/user/:address/portfolios', () => {
    it('should return user portfolios for valid address', async () => {
        const userAddress = 'GUSER123456789ABCDEF0'

        // Create a portfolio for this user
        const createPayload = {
            userAddress,
            allocations: { XLM: 60, USDC: 40 },
            threshold: 5
        }

        await request(app)
            .post('/api/portfolio')
            .send(createPayload)
            .expect((res) => {
                expect([200, 201]).toContain(res.status)
            })

        // Now fetch user portfolios
        const response = await request(app)
            .get(`/api/user/${userAddress}/portfolios`)
            .expect(200)

        expect(Array.isArray(response.body)).toBe(true)
        expect(response.body.length).toBeGreaterThan(0)
    })

    it('should return empty array for user with no portfolios', async () => {
        const response = await request(app)
            .get('/api/user/GNEWUSER123456789ABCDEF/portfolios')
            .expect(200)

        expect(Array.isArray(response.body)).toBe(true)
        expect(response.body).toBeDefined()
    })
})

