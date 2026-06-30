/**
 * Integration tests for GET /api/portfolio/:id/export?format=json|csv|pdf
 *
 * Issue #265 — GDPR export: content type, content-disposition filename,
 * ownership checks, invalid format, and missing portfolio.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express, { type Express } from 'express'
import request from 'supertest'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import jwt from 'jsonwebtoken'
import { portfolioRouter } from '../api/routes.js'
import { vi } from 'vitest'
import type { Job } from 'bullmq'
import { portfolioStorage } from '../services/portfolioStorage.js'

const mockPortfolios = new Map<string, any>()
const mockPortfolioIds = ['a1b2c3d4', 'b2c3d4e5', 'c3d4e5f6', 'd4e5f6a7']

vi.mock('../services/databaseService.js', () => ({
    databaseService: {
        hasFullConsent: vi.fn(() => true),
    },
}))

vi.mock('../services/portfolioStorage.js', () => ({
    portfolioStorage: {
        getPortfolio: vi.fn(async (id: string) => mockPortfolios.get(id)),
        createPortfolio: vi.fn(async (userAddress: string, allocations: Record<string, number>, threshold: number, name?: string, description?: string) => {
            const id = mockPortfolioIds[mockPortfolios.size] ?? `p${mockPortfolios.size + 1}`
            mockPortfolios.set(id, {
                id,
                userAddress,
                allocations,
                threshold,
                slippageTolerancePercent: 1,
                strategy: 'threshold',
                strategyConfig: {},
                name,
                description,
                balances: {},
                totalValue: 0,
                createdAt: new Date().toISOString(),
                lastRebalance: new Date().toISOString(),
                version: 1,
            })
            return id
        }),
    },
}))

vi.mock('../services/stellar.js', () => ({
    StellarService: class {
        async getPortfolio(portfolioId: string) {
            return mockPortfolios.get(portfolioId) ?? null
        }

        async createPortfolio(
            userAddress: string,
            allocations: Record<string, number>,
            threshold: number,
            slippageTolerancePercent: number,
            strategy: string,
            strategyConfig: Record<string, unknown>,
            name?: string,
            description?: string,
        ) {
            const id = mockPortfolioIds[mockPortfolios.size] ?? `p${mockPortfolios.size + 1}`
            mockPortfolios.set(id, {
                id,
                userAddress,
                allocations,
                threshold,
                slippageTolerancePercent,
                strategy,
                strategyConfig,
                name,
                description,
                balances: {},
                totalValue: 0,
                createdAt: new Date().toISOString(),
                lastRebalance: new Date().toISOString(),
                version: 1,
            })
            return id
        }
    },
}))

vi.mock('../services/reflector.js', () => ({
    ReflectorService: class {
        async getCurrentPrices() {
            return {}
        }
    },
}))

vi.mock('../services/serviceContainer.js', () => ({
    riskManagementService: {
        calculateRiskHeatmap: vi.fn(() => null),
    },
    rebalanceHistoryService: {},
}))

vi.mock('../queue/workers/workerRuntime.js', () => ({
    acquireWorkerLock: vi.fn(),
    releaseWorkerLock: vi.fn(),
    createWorkerRuntimeStatus: vi.fn(() => ({ isHealthy: true, status: 'idle' })),
}))

vi.mock('../api/analytics.routes.js', () => ({
    analyticsRouter: express.Router(),
}))

vi.mock('../utils/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}))

vi.mock('../queue/queues.js', () => {
    let mockJobCounter = 0
    const mockJobs = new Map<string, any>()
    return {
        QUEUE_NAMES: { PORTFOLIO_EXPORT: 'portfolio-export' },
        getPortfolioExportQueue: vi.fn().mockReturnValue({
            add: vi.fn().mockImplementation(async (name, data) => {
                const id = `mock-job-${++mockJobCounter}`
                
                // create a mock job payload based on the format
                let returnvalue: any = {
                    contentType: 'application/json',
                    filename: `portfolio-${data.portfolioId.slice(0, 8)}-export-2026.json`,
                    bodyString: JSON.stringify({
                        meta: { format: 'json', purpose: 'GDPR data export' },
                        portfolioId: data.portfolioId,
                        exportedAt: new Date().toISOString(),
                        rebalanceHistory: []
                    })
                }
                if (data.format === 'csv') {
                    returnvalue = {
                        contentType: 'text/csv',
                        filename: `portfolio-${data.portfolioId.slice(0, 8)}-export-2026.csv`,
                        bodyString: 'id,portfolioId,timestamp,trigger,trades,gasUsed,status,eventSource,onChainTxHash,isAutomatic,fromAsset,toAsset,amount\n'
                    }
                } else if (data.format === 'pdf') {
                    returnvalue = {
                        contentType: 'application/pdf',
                        filename: `portfolio-${data.portfolioId.slice(0, 8)}-export-2026.pdf`,
                        bodyBase64: Buffer.from('%PDF-mock').toString('base64')
                    }
                }
                
                const job = { 
                    id, 
                    data, 
                    getState: async () => 'completed', 
                    returnvalue,
                    failedReason: undefined
                }
                mockJobs.set(id, job)
                return job
            }),
            getJob: vi.fn().mockImplementation(async (id) => mockJobs.get(id))
        })
    }
})

// ─── Constants ────────────────────────────────────────────────────────────────

// Must be >= 32 chars — getAuthConfig() enforces MIN_SECRET_LENGTH = 32
const TEST_JWT_SECRET = 'test-secret-for-export-tests-x32'
const OWNER_ADDRESS = 'GEXPORT1234567890ABCDEF'

function mintJwt(address: string): string {
    return jwt.sign({ sub: address, type: 'access' }, TEST_JWT_SECRET, { expiresIn: '1h' })
}

// ─── App bootstrap ────────────────────────────────────────────────────────────

function buildApp(): Express {
    const a = express()
    a.use(express.json({ limit: '10mb' }))
    a.use(express.urlencoded({ extended: true }))
    a.use('/api', portfolioRouter)
    a.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: String(err) }, data: null })
    })
    return a
}

// ─── Shared state ─────────────────────────────────────────────────────────────

let app: Express
let testDbPath: string
let sharedPortfolioId: string

beforeAll(async () => {
    const testDir = join(tmpdir(), `export-int-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    testDbPath = join(testDir, 'test.db')

    // Auth off for setup — requireJwtWhenEnabled checks JWT_SECRET presence at request time
    delete process.env.JWT_SECRET
    process.env.DB_PATH = testDbPath

    app = buildApp()

    const res = await request(app)
        .post('/api/portfolio')
        .send({
            userAddress: OWNER_ADDRESS,
            allocations: { XLM: 60, USDC: 40 },
            threshold: 5,
            slippageTolerance: 1.5,
            strategy: 'periodic',
            strategyConfig: { intervalDays: 14 },
            name: 'JSON export source',
            description: 'Source portfolio for import/export round-trip tests',
        })
    expect([200, 201]).toContain(res.status)
    sharedPortfolioId = res.body.data.portfolioId as string
})

afterAll(() => {
    delete process.env.JWT_SECRET
    delete process.env.DB_PATH
    if (existsSync(testDbPath)) {
        try { rmSync(testDbPath, { force: true }) } catch { /* ignore */ }
    }
})


// ─── JSON export / import ────────────────────────────────────────────────────

describe('JSON export — GET /api/portfolio/:id/export?format=json', () => {
    it('returns the portfolio configuration as JSON', async () => {
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=json`)
            .expect(200)

        expect(res.body.schemaVersion).toBe(1)
        expect(res.body.userAddress).toBe(OWNER_ADDRESS)
        expect(res.body.allocations).toEqual({ XLM: 60, USDC: 40 })
        expect(res.body.threshold).toBe(5)
        expect(res.body.slippageTolerance).toBe(1.5)
        expect(res.body.strategy).toBe('periodic')
        expect(res.body.strategyConfig).toEqual({ intervalDays: 14 })
        expect(res.body.name).toBe('JSON export source')
        expect(res.body.description).toBe('Source portfolio for import/export round-trip tests')
        expect(res.body.exportedAt).toBeDefined()
    })
})

describe('JSON import — POST /api/portfolio/import', () => {
    it('creates a portfolio from exported JSON and preserves settings', async () => {
        const exportRes = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=json`)
            .expect(200)

        const importRes = await request(app)
            .post('/api/portfolio/import')
            .send(exportRes.body)
            .expect(201)

        const importedId = importRes.body.data.portfolioId as string
        expect(importedId).toBeTruthy()

        const imported = await portfolioStorage.getPortfolio(importedId)
        expect(imported).toBeTruthy()
        expect(imported?.userAddress).toBe(OWNER_ADDRESS)
        expect(imported?.allocations).toEqual({ XLM: 60, USDC: 40 })
        expect(imported?.threshold).toBe(5)
        expect(imported?.slippageTolerancePercent ?? imported?.slippageTolerance).toBe(1.5)
        expect(imported?.strategy).toBe('periodic')
        expect(imported?.strategyConfig).toEqual({ intervalDays: 14 })
        expect(imported?.name).toBe('JSON export source')
        expect(imported?.description).toBe('Source portfolio for import/export round-trip tests')
    })

    it('rejects imports with more than 10 assets', async () => {
        const exportRes = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=json`)
            .expect(200)

        const invalidAllocations = { ...exportRes.body.allocations }
        for (let index = 0; index < 9; index += 1) {
            invalidAllocations[`ASSET_${index}`] = 0
        }

        const res = await request(app)
            .post('/api/portfolio/import')
            .send({
                ...exportRes.body,
                allocations: invalidAllocations,
            })
            .expect(422)

        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('rejects imports whose allocations do not sum to 100%', async () => {
        const exportRes = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=json`)
            .expect(200)

        const res = await request(app)
            .post('/api/portfolio/import')
            .send({
                ...exportRes.body,
                allocations: { XLM: 59, USDC: 40 },
            })
            .expect(422)

        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
})

// ─── CSV export ───────────────────────────────────────────────────────────────

describe('CSV export — GET /api/portfolio/:id/export?format=csv', () => {
    it('responds 202 and then text/csv content-type', async () => {
        const createRes = await request(app).get(`/api/portfolio/${sharedPortfolioId}/export?format=csv`).expect(202)
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export/status/${createRes.body.data.jobId}`)
            .expect(200)
        expect(res.headers['content-type']).toMatch(/text\/csv/)
    })

    it('content-disposition is attachment with a .csv filename', async () => {
        const createRes = await request(app).get(`/api/portfolio/${sharedPortfolioId}/export?format=csv`)
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export/status/${createRes.body.data.jobId}`)
            .expect(200)
        const disposition = res.headers['content-disposition'] as string
        expect(disposition).toMatch(/^attachment/)
        expect(disposition).toMatch(/\.csv"$/)
    })

    it('filename matches pattern portfolio-<8chars>-export-<timestamp>.csv', async () => {
        const createRes = await request(app).get(`/api/portfolio/${sharedPortfolioId}/export?format=csv`)
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export/status/${createRes.body.data.jobId}`)
            .expect(200)
        const match = (res.headers['content-disposition'] as string).match(/filename="([^"]+)"/)
        expect(match).not.toBeNull()
        expect(match![1]).toMatch(/^portfolio-[0-9a-f-]{8}-export-.*\.csv$/)
    })

    it('body first line is the canonical CSV header', async () => {
        const createRes = await request(app).get(`/api/portfolio/${sharedPortfolioId}/export?format=csv`)
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export/status/${createRes.body.data.jobId}`)
            .expect(200)
        const firstLine = (res.text as string).split('\n')[0]
        expect(firstLine).toBe(
            'id,portfolioId,timestamp,trigger,trades,gasUsed,status,eventSource,onChainTxHash,isAutomatic,fromAsset,toAsset,amount'
        )
    })
})

// ─── PDF export ───────────────────────────────────────────────────────────────

describe('PDF export — GET /api/portfolio/:id/export?format=pdf', () => {
    it('responds 202 and then application/pdf content-type', async () => {
        const createRes = await request(app).get(`/api/portfolio/${sharedPortfolioId}/export?format=pdf`).expect(202)
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export/status/${createRes.body.data.jobId}`)
            .buffer(true).expect(200)
        expect(res.headers['content-type']).toMatch(/application\/pdf/)
    })

    it('content-disposition is attachment with a .pdf filename', async () => {
        const createRes = await request(app).get(`/api/portfolio/${sharedPortfolioId}/export?format=pdf`)
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export/status/${createRes.body.data.jobId}`)
            .buffer(true).expect(200)
        const disposition = res.headers['content-disposition'] as string
        expect(disposition).toMatch(/^attachment/)
        expect(disposition).toMatch(/\.pdf"$/)
    })

    it('filename matches pattern portfolio-<8chars>-export-<timestamp>.pdf', async () => {
        const createRes = await request(app).get(`/api/portfolio/${sharedPortfolioId}/export?format=pdf`)
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export/status/${createRes.body.data.jobId}`)
            .buffer(true).expect(200)
        const match = (res.headers['content-disposition'] as string).match(/filename="([^"]+)"/)
        expect(match).not.toBeNull()
        expect(match![1]).toMatch(/^portfolio-[0-9a-f-]{8}-export-.*\.pdf$/)
    })

    it('body is a non-empty buffer starting with PDF magic bytes %PDF', async () => {
        const createRes = await request(app).get(`/api/portfolio/${sharedPortfolioId}/export?format=pdf`)
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export/status/${createRes.body.data.jobId}`)
            .buffer(true)
            .parse((httpRes, callback) => {
                const chunks: Buffer[] = []
                httpRes.on('data', (c: Buffer) => chunks.push(c))
                httpRes.on('end', () => callback(null, Buffer.concat(chunks)))
            })
            .expect(200)
        const body = res.body as Buffer
        expect(body.length).toBeGreaterThan(0)
        expect(Buffer.from(body).subarray(0, 4).toString('ascii')).toBe('%PDF')
    })
})

// ─── Error handling ───────────────────────────────────────────────────────────

describe('Export error handling', () => {
    it('returns 404 when portfolio does not exist', async () => {
        const res = await request(app)
            .get('/api/portfolio/00000000-dead-beef-0000-nonexistent1/export?format=json')
            .expect(404)
        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('NOT_FOUND')
    })

    it('returns 400 for an unsupported format (xlsx)', async () => {
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=xlsx`)
            .expect(422)
        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns JSON when format query param is omitted', async () => {
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export`)
            .expect(200)
        expect(res.body.schemaVersion).toBe(1)
        expect(res.body.userAddress).toBe(OWNER_ADDRESS)
    })

    it('returns 400 for an empty format param', async () => {
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=`)
            .expect(422)
        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 for format=XML (case sensitivity)', async () => {
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=XML`)
            .expect(422)
        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
})

// ─── Ownership enforcement ────────────────────────────────────────────────────
//
// requireJwtWhenEnabled reads process.env.JWT_SECRET on every request, so we
// can enable/disable auth by setting/deleting the env var — no module reload needed.

describe('Ownership enforcement (auth enabled)', () => {
    beforeAll(() => {
        process.env.JWT_SECRET = TEST_JWT_SECRET
    })

    afterAll(() => {
        delete process.env.JWT_SECRET
    })

    it('401 when no Authorization header is provided', async () => {
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=json`)
            .expect(401)
        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('UNAUTHORIZED')
    })

    it('403 when a JWT for a different address attempts to export', async () => {
        const attackerToken = mintJwt('GATTACKER1234567890ABCDEF')
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=json`)
            .set('Authorization', `Bearer ${attackerToken}`)
            .expect(403)
        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('FORBIDDEN')
    })

    it('200 when the correct owner JWT is provided', async () => {
        const ownerToken = mintJwt(OWNER_ADDRESS)
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=json`)
            .set('Authorization', `Bearer ${ownerToken}`)
            .expect(200)
        expect(res.headers['content-type']).toMatch(/application\/json/)
        expect(res.body.userAddress).toBe(OWNER_ADDRESS)
    })
})
