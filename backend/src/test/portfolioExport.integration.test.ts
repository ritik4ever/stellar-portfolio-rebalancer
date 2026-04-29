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
        .send({ userAddress: OWNER_ADDRESS, allocations: { XLM: 60, USDC: 40 }, threshold: 5 })
    expect([200, 201]).toContain(res.status)
    sharedPortfolioId = res.body.data.portfolioId as string

    await request(app)
        .post('/api/consent')
        .send({ userId: OWNER_ADDRESS, terms: true, privacy: true, cookies: true })
        .expect(200)
})

afterAll(() => {
    delete process.env.JWT_SECRET
    delete process.env.DB_PATH
    if (existsSync(testDbPath)) {
        try { rmSync(testDbPath, { force: true }) } catch { /* ignore */ }
    }
})


// ─── JSON export ──────────────────────────────────────────────────────────────

describe('JSON export — GET /api/portfolio/:id/export?format=json', () => {
    it('responds 200 with application/json content-type', async () => {
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=json`)
            .expect(200)
        expect(res.headers['content-type']).toMatch(/application\/json/)
    })

    it('content-disposition is attachment with a .json filename', async () => {
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=json`)
            .expect(200)
        const disposition = res.headers['content-disposition'] as string
        expect(disposition).toMatch(/^attachment/)
        expect(disposition).toMatch(/\.json"$/)
    })

    it('filename matches pattern portfolio_<8chars>_<timestamp>.json', async () => {
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=json`)
            .expect(200)
        const match = (res.headers['content-disposition'] as string).match(/filename="([^"]+)"/)
        expect(match).not.toBeNull()
        expect(match![1]).toMatch(/^portfolio_[0-9a-f-]{8}_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/)
    })

    it('body is valid JSON with GDPR meta fields', async () => {
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=json`)
            .expect(200)
        const body = typeof res.body === 'object' ? res.body : JSON.parse(res.text)
        expect(body.meta?.format).toBe('json')
        expect(body.meta?.purpose).toBe('GDPR data export')
        expect(body.portfolioId).toBe(sharedPortfolioId)
        expect(body.exportedAt).toBeDefined()
        expect(Array.isArray(body.rebalanceHistory)).toBe(true)
    })
})

// ─── CSV export ───────────────────────────────────────────────────────────────

describe('CSV export — GET /api/portfolio/:id/export?format=csv', () => {
    it('responds 200 with text/csv content-type', async () => {
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=csv`)
            .expect(200)
        expect(res.headers['content-type']).toMatch(/text\/csv/)
    })

    it('content-disposition is attachment with a .csv filename', async () => {
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=csv`)
            .expect(200)
        const disposition = res.headers['content-disposition'] as string
        expect(disposition).toMatch(/^attachment/)
        expect(disposition).toMatch(/\.csv"$/)
    })

    it('filename matches pattern portfolio_<8chars>_rebalance_history_<timestamp>.csv', async () => {
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=csv`)
            .expect(200)
        const match = (res.headers['content-disposition'] as string).match(/filename="([^"]+)"/)
        expect(match).not.toBeNull()
        expect(match![1]).toMatch(
            /^portfolio_[0-9a-f-]{8}_rebalance_history_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/
        )
    })

    it('body first line is the canonical CSV header', async () => {
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=csv`)
            .expect(200)
        const firstLine = (res.text as string).split('\n')[0]
        expect(firstLine).toBe(
            'id,portfolioId,timestamp,trigger,trades,gasUsed,status,eventSource,onChainTxHash,isAutomatic,fromAsset,toAsset,amount'
        )
    })
})

// ─── PDF export ───────────────────────────────────────────────────────────────

describe('PDF export — GET /api/portfolio/:id/export?format=pdf', () => {
    it('responds 200 with application/pdf content-type', async () => {
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=pdf`)
            .buffer(true).expect(200)
        expect(res.headers['content-type']).toMatch(/application\/pdf/)
    })

    it('content-disposition is attachment with a .pdf filename', async () => {
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=pdf`)
            .buffer(true).expect(200)
        const disposition = res.headers['content-disposition'] as string
        expect(disposition).toMatch(/^attachment/)
        expect(disposition).toMatch(/\.pdf"$/)
    })

    it('filename matches pattern portfolio_<8chars>_report_<timestamp>.pdf', async () => {
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=pdf`)
            .buffer(true).expect(200)
        const match = (res.headers['content-disposition'] as string).match(/filename="([^"]+)"/)
        expect(match).not.toBeNull()
        expect(match![1]).toMatch(/^portfolio_[0-9a-f-]{8}_report_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.pdf$/)
    })

    it('body is a non-empty buffer starting with PDF magic bytes %PDF', async () => {
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=pdf`)
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
            .expect(400)
        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 when format query param is omitted', async () => {
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export`)
            .expect(400)
        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 for an empty format param', async () => {
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=`)
            .expect(400)
        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 for format=XML (case sensitivity)', async () => {
        const res = await request(app)
            .get(`/api/portfolio/${sharedPortfolioId}/export?format=XML`)
            .expect(400)
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
        const body = typeof res.body === 'object' ? res.body : JSON.parse(res.text)
        expect(body.meta?.purpose).toBe('GDPR data export')
    })
})
