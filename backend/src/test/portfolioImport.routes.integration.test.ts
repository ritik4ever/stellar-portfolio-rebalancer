import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import express from 'express'
import type { Express } from 'express'
import cors from 'cors'
import request from 'supertest'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

async function createApp(): Promise<Express> {
  const app = express()
  app.use(cors({ origin: true, credentials: true }))
  app.use(express.json({ limit: '10mb' }))
  app.use(express.text({ type: 'text/csv' }))
  app.set('trust proxy', 1)

  const { portfolioRouter } = await import('../api/routes.js') as any
  app.use('/api/v1', portfolioRouter)

  return app
}

describe('Portfolio Import Route Integration', () => {
  let app: Express
  let testDbPath: string

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    const testDir = join(tmpdir(), `stellar-import-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    testDbPath = join(testDir, 'test.db')
    process.env.DB_PATH = testDbPath
    app = await createApp()
  }, 60000)

  afterAll(() => {
    if (existsSync(testDbPath)) {
      try { rmSync(testDbPath, { force: true }) } catch {}
    }
    delete process.env.DB_PATH
  })

  it('POST /api/v1/portfolio/import responds with no route collisions', async () => {
    const res = await request(app)
      .post('/api/v1/portfolio/import')
      .send({
        userAddress: 'GIMPORTTEST123456789ABCDEF',
        allocations: [
          { asset: 'XLM', allocation_pct: 60 },
          { asset: 'USDC', allocation_pct: 40 },
        ],
      })

    expect([200, 201, 400, 500]).toContain(res.status)
    if (res.status === 400) {
      expect(res.body.error).toBeDefined()
    }
  })

  it('POST /api/v1/portfolio/import returns validation errors for bad payload', async () => {
    const res = await request(app)
      .post('/api/v1/portfolio/import')
      .send({
        userAddress: 'GIMPORTTEST123456789ABCDEF',
        allocations: [
          { asset: 'XLM', allocation_pct: 60 },
          { asset: 'USDC', allocation_pct: 30 },
        ],
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it('POST /api/v1/portfolio/import rejects missing userAddress', async () => {
    const res = await request(app)
      .post('/api/v1/portfolio/import')
      .send({
        allocations: [
          { asset: 'XLM', allocation_pct: 60 },
          { asset: 'USDC', allocation_pct: 40 },
        ],
      })

    expect(res.status).toBe(400)
  })

  it('existing portfolio CRUD routes remain unaffected', async () => {
    const res = await request(app)
      .post('/api/v1/portfolio')
      .send({
        userAddress: 'GIMPORTTEST123456789ABCDEF',
        allocations: { XLM: 60, USDC: 40 },
        threshold: 5,
      })

    expect([200, 201]).toContain(res.status)
    expect(res.body.success).toBe(true)
  })
})
