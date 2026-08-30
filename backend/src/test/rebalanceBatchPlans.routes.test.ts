import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import express, { type Express } from 'express'
import cors from 'cors'
import request from 'supertest'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Portfolio } from '../types/index.js'

const PRICES = {
  XLM: { price: 0.35, change: 0, timestamp: Date.now() },
  USDC: { price: 1, change: 0, timestamp: Date.now() },
}

const FEED_META = {
  provider: 'backend' as const,
  resolvedAtMs: Date.now(),
  degraded: false,
  staleOrLimited: false,
  resolutionHint: 'fresh_primary' as const,
  assetsCount: 2,
}

const { mockGetPortfolio } = vi.hoisted(() => ({
  mockGetPortfolio: vi.fn(),
}))

const { mockGetCurrentPricesWithMeta } = vi.hoisted(() => ({
  mockGetCurrentPricesWithMeta: vi.fn(),
}))

const { mockExecuteRebalance } = vi.hoisted(() => ({
  mockExecuteRebalance: vi.fn(),
}))

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../services/reflector.js', () => {
  function ReflectorService(this: unknown) {
    ;(this as { getCurrentPricesWithMeta: typeof mockGetCurrentPricesWithMeta }).getCurrentPricesWithMeta = mockGetCurrentPricesWithMeta
  }
  return { ReflectorService }
})

vi.mock('../services/stellar.js', () => {
  function StellarService(this: unknown) {
    const self = this as Record<string, unknown>
    self.createPortfolio = vi.fn()
    self.getPortfolio = vi.fn()
    self.executeRebalance = mockExecuteRebalance
  }
  return { StellarService }
})

vi.mock('../services/portfolioStorage.js', () => ({
  portfolioStorage: {
    getPortfolio: mockGetPortfolio,
    getUserPortfolios: vi.fn().mockResolvedValue([]),
    getAllPortfolios: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('../services/databaseService.js', () => ({
  databaseService: {
    getPublicShareByPortfolioId: vi.fn(),
    createPublicShare: vi.fn(),
    revokePublicShare: vi.fn(),
    getPublicShareByHash: vi.fn(),
    createDraft: vi.fn(),
    getDraft: vi.fn(),
    updateDraft: vi.fn(),
    publishDraft: vi.fn(),
    deleteDraft: vi.fn(),
    listDrafts: vi.fn(),
    hasFullConsent: vi.fn().mockReturnValue(true),
  },
}))

vi.mock('../services/serviceContainer.js', () => ({
  rebalanceHistoryService: { recordRebalanceEvent: vi.fn() },
  riskManagementService: { shouldAllowRebalance: vi.fn().mockReturnValue({ allowed: true, reason: 'OK', alerts: [] }) },
}))

function makePortfolio(id: string, allocations: Record<string, number>, balances: Record<string, number>): Portfolio {
  return {
    id,
    userAddress: 'GABC',
    allocations,
    threshold: 5,
    balances,
    totalValue: 0,
    createdAt: new Date().toISOString(),
    lastRebalance: new Date().toISOString(),
    version: 1,
  }
}

describe('POST /api/portfolios/rebalance-plans (batch, no trades)', () => {
  let app: Express
  let testDbPath: string

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'
    const testDir = join(tmpdir(), `rebalance-batch-plans-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    testDbPath = join(testDir, 'test.db')
    process.env.DB_PATH = testDbPath

    const appInstance = express()
    appInstance.use(cors({ origin: true, credentials: true }))
    appInstance.use(express.json())
    const { portfoliosRouter } = await import('../api/portfolios.routes.js')
    appInstance.use('/api', portfoliosRouter)
    app = appInstance
  })

  afterAll(() => {
    if (existsSync(testDbPath)) {
      try { rmSync(testDbPath, { force: true }) } catch { /* ignore */ }
    }
    delete process.env.DB_PATH
    delete process.env.NODE_ENV
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCurrentPricesWithMeta.mockResolvedValue({ prices: PRICES, feedMeta: FEED_META })
    mockGetPortfolio.mockImplementation((id: string) => {
      if (id === 'batch-a') {
        return Promise.resolve(makePortfolio('batch-a', { XLM: 60, USDC: 40 }, { XLM: 1000, USDC: 100 }))
      }
      if (id === 'batch-b') {
        return Promise.resolve(makePortfolio('batch-b', {}, {}))
      }
      return Promise.resolve(undefined)
    })
  })

  it('computes plans for multiple portfolios and returns a combined summary', async () => {
    const res = await request(app)
      .post('/api/portfolios/rebalance-plans')
      .send({ portfolioIds: ['batch-a', 'batch-b'] })
      .expect(200)

    expect(res.body.success).toBe(true)
    expect(res.body.data.plans.map((p: { portfolioId: string }) => p.portfolioId)).toEqual(['batch-a', 'batch-b'])
    expect(res.body.data.failed).toEqual([])
    expect(res.body.data.summary.totalPortfolios).toBe(2)
    expect(res.body.data.summary.plansGenerated).toBe(2)
    expect(res.body.data.summary.failedCount).toBe(0)
    expect(res.body.data.summary.totalTrades).toBe(res.body.data.plans[0].estimatedFees.tradeCount)
    // Batch-b is empty (zero trades), so the summary only reflects batch-a fees.
    expect(res.body.data.summary.totalEstimatedFeesXlm).toBe(res.body.data.plans[0].estimatedFees.xlm)
  })

  it('isolates missing portfolios without blocking plans for the others', async () => {
    const res = await request(app)
      .post('/api/portfolios/rebalance-plans')
      .send({ portfolioIds: ['batch-a', 'does-not-exist', 'batch-b'] })
      .expect(200)

    expect(res.body.data.plans.map((p: { portfolioId: string }) => p.portfolioId)).toEqual(['batch-a', 'batch-b'])
    expect(res.body.data.failed).toEqual([{ portfolioId: 'does-not-exist', error: 'Portfolio not found' }])
    expect(res.body.data.summary.plansGenerated).toBe(2)
    expect(res.body.data.summary.failedCount).toBe(1)
    expect(res.body.data.summary.totalPortfolios).toBe(3)
  })

  it('validates the request body', async () => {
    const res = await request(app)
      .post('/api/portfolios/rebalance-plans')
      .send({ portfolioIds: [] })
      .expect(422)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('does not execute any trades', async () => {
    await request(app)
      .post('/api/portfolios/rebalance-plans')
      .send({ portfolioIds: ['batch-a'] })
      .expect(200)

    expect(mockExecuteRebalance).not.toHaveBeenCalled()
  })
})