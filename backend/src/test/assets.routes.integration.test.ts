import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { Express } from 'express'
import request from 'supertest'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let app: Express
let testDbPath: string
const envBackup: NodeJS.ProcessEnv = { ...process.env }

beforeAll(async () => {
    const testDir = join(tmpdir(), `stellar-assets-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    testDbPath = join(testDir, 'assets-test.db')

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

afterAll(() => {
    process.env = envBackup
    if (testDbPath) {
        const dir = join(testDbPath, '..')
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    }
})

describe('assets routes integration', () => {
    it('GET /api/v1/assets returns paginated asset list', async () => {
        const res = await request(app).get('/api/v1/assets?page=1&limit=2').expect(200)

        expect(res.body.success).toBe(true)
        expect(Array.isArray(res.body.data.assets)).toBe(true)
        expect(res.body.data.assets.length).toBeLessThanOrEqual(2)
        expect(res.body.data.page).toBe(1)
        expect(res.body.data.limit).toBe(2)
        expect(typeof res.body.data.total).toBe('number')
        expect(res.body.data.total).toBeGreaterThan(0)
    })

    it('filters assets by asset code with matching and non-matching queries', async () => {
        const match = await request(app).get('/api/v1/assets?code=XLM').expect(200)
        expect(match.body.data.assets.length).toBeGreaterThan(0)
        expect(match.body.data.assets.every((asset: { symbol: string }) => asset.symbol.includes('XLM'))).toBe(true)

        const noMatch = await request(app).get('/api/v1/assets?code=DOES_NOT_EXIST').expect(200)
        expect(noMatch.body.data.assets).toEqual([])
        expect(noMatch.body.data.total).toBe(0)
    })

    it('GET /api/v1/assets/:id returns 404 for unknown asset', async () => {
        const res = await request(app).get('/api/v1/assets/UNKNOWN_ASSET').expect(404)
        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('NOT_FOUND')
    })

    it('allows public browsing without Authorization header', async () => {
        const res = await request(app).get('/api/v1/assets').expect(200)
        expect(res.body.success).toBe(true)
    })
})
