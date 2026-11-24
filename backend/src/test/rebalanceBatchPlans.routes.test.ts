import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import express, { type Express } from 'express'
import cors from 'cors'
import request from 'supertest'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Portfolio } from '../types/index.js'
import { rebalanceHistoryService } from '../services/serviceContainer.js'

const QUOTE_TIMESTAMP = 1_700_000_000
const PRICES = {
  XLM: { price: 0.35, change: 0, timestamp: QUOTE_TIMESTAMP },
  USDC: { price: 1, change: 0, timestamp: QUOTE_TIMESTAMP },
}

const FEED_META = {
  provider: 'backend' as const,
  resolvedAtMs: QUOTE_TIMESTAMP * 1000,
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
    createdAt: new Date(QUOTE_TIMESTAMP * 1000).toISOString(),
    lastRebalance: new Date(QUOTE_TIMESTAMP * 1000).toISOString(),
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

  it('uses one snapshot per request and keeps previews read-only through a price feed failure and retry', async () => {
    mockGetPortfolio.mockResolvedValue(makePortfolio('within-threshold', { XLM: 50, USDC: 50 }, { XLM: 55, USDC: 45 }))
    const earlyPrices = { ...PRICES, XLM: { ...PRICES.XLM, price: 1, source: 'reflector', ledger: 200 } }
    const laterPrices = { ...earlyPrices, XLM: { ...earlyPrices.XLM, price: 2, ledger: 201, timestamp: QUOTE_TIMESTAMP + 1 } }
    const laterMeta = { ...FEED_META, resolvedAtMs: FEED_META.resolvedAtMs + 1000 }
    mockGetCurrentPricesWithMeta
      .mockResolvedValueOnce({ prices: earlyPrices, feedMeta: FEED_META })
      .mockRejectedValueOnce(new Error('interrupted price read'))
      .mockResolvedValue({ prices: laterPrices, feedMeta: laterMeta })

    const url = '/api/portfolio/within-threshold/rebalance-plan'
    const initial = await request(app).get(url).expect(200)
    expect(initial.body.data).toMatchObject({
      prices: earlyPrices,
      estimatedFees: { tradeCount: 0, xlm: 0, usd: 0 },
      projectedAllocations: { USDC: 45, XLM: 55 },
      boundary: {
        result: 'no_trades_needed',
        reasonCode: 'WITHIN_EVERY_THRESHOLD',
        maxDriftPercent: 5,
        trades: [],
        quoteSnapshot: { prices: earlyPrices, feedMeta: FEED_META },
      },
    })

    const responses = await Promise.all([request(app).get(url), request(app).get(url)])
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 500])
    const success = responses.find(({ status }) => status === 200)
    const retry = await request(app).get(url).expect(200)
    expect(retry.body.data).toEqual(success?.body.data)
    expect(retry.body.data).toMatchObject({
      prices: laterPrices,
      estimatedFees: { tradeCount: 2 },
      boundary: {
        trades: [
          { asset: 'USDC', action: 'buy', amount: 32.5, value: 32.5 },
          { asset: 'XLM', action: 'sell', amount: 16.25, value: 32.5 },
        ],
        quoteSnapshot: { prices: laterPrices, feedMeta: laterMeta },
      },
    })
    expect(mockGetPortfolio).toHaveBeenCalledTimes(4)
    expect(mockGetCurrentPricesWithMeta).toHaveBeenCalledTimes(4)
    expect(mockExecuteRebalance).not.toHaveBeenCalled()
    expect(rebalanceHistoryService.recordRebalanceEvent).not.toHaveBeenCalled()
  })

  it('does not execute any trades', async () => {
    await request(app)
      .post('/api/portfolios/rebalance-plans')
      .send({ portfolioIds: ['batch-a'] })
      .expect(200)

    expect(mockExecuteRebalance).not.toHaveBeenCalled()
  })
})