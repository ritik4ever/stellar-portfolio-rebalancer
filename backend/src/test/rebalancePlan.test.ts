import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildRebalancePlan, buildBatchRebalancePlan } from '../services/rebalancePlan.js'
import type { Portfolio, PricesMap, PriceFeedMeta } from '../types/index.js'

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const prices: PricesMap = {
  XLM: { price: 0.35, change: 0, timestamp: Date.now() },
  USDC: { price: 1, change: 0, timestamp: Date.now() },
}

const feedMeta: PriceFeedMeta = {
  provider: 'backend',
  resolvedAtMs: Date.now(),
  degraded: false,
  staleOrLimited: false,
  resolutionHint: 'fresh_primary',
  assetsCount: 2,
}

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

describe('buildRebalancePlan', () => {
  beforeEach(() => {
    delete process.env.REBALANCE_DRY_RUN_BASE_FEE_STROOPS
  })

  afterEach(() => {
    delete process.env.REBALANCE_DRY_RUN_BASE_FEE_STROOPS
  })

  it('computes buy/sell/hold actions and fee estimate for a single portfolio', () => {
    const portfolio = makePortfolio(
      'p-1',
      { XLM: 60, USDC: 40 },
      { XLM: 1000, USDC: 100 },
    )

    const plan = buildRebalancePlan(portfolio, prices, feedMeta)

    expect(plan.portfolioId).toBe('p-1')
    expect(plan.assets.length).toBe(2)
    const trades = plan.assets.filter((a) => a.action !== 'hold')
    expect(trades.length).toBeGreaterThan(0)
    expect(plan.estimatedFees.tradeCount).toBe(trades.length)
    expect(plan.estimatedFees.xlm).toBeGreaterThan(0)
    expect(plan.totalValue).toBeCloseTo(1000 * 0.35 + 100)
  })

  it('produces a zero-trade zero-fee plan for an empty portfolio', () => {
    const portfolio = makePortfolio('p-empty', {}, {})
    const plan = buildRebalancePlan(portfolio, prices, feedMeta)
    expect(plan.assets).toEqual([])
    expect(plan.estimatedFees.tradeCount).toBe(0)
    expect(plan.estimatedFees.xlm).toBe(0)
  })
})

describe('buildBatchRebalancePlan', () => {
  it('plans a batch and aggregates total trades / fees', () => {
    const portfolioA = makePortfolio(
      'batch-a',
      { XLM: 60, USDC: 40 },
      { XLM: 1000, USDC: 100 },
    )
    const portfolioB = makePortfolio('batch-b', {}, {})

    const result = buildBatchRebalancePlan([portfolioA, portfolioB], prices, feedMeta)

    expect(result.plans.length).toBe(2)
    expect(result.failed.length).toBe(0)
    expect(result.summary.totalPortfolios).toBe(2)
    expect(result.summary.plansGenerated).toBe(2)
    expect(result.summary.failedCount).toBe(0)
    expect(result.summary.totalTrades).toBe(result.plans[0].estimatedFees.tradeCount)
    expect(result.summary.totalEstimatedFeesXlm).toBeCloseTo(result.plans[0].estimatedFees.xlm)
    expect(result.summary.totalEstimatedFeesUsd).toBeCloseTo(result.plans[0].estimatedFees.usd)
  })

  it('isolates per-portfolio planning failures without blocking the rest', () => {
    const goodPortfolio = makePortfolio(
      'batch-good',
      { XLM: 60, USDC: 40 },
      { XLM: 1000, USDC: 100 },
    )

    // A portfolio whose allocations getter throws while being read.
    const badPortfolio = makePortfolio('batch-bad', {}, {})
    Object.defineProperty(badPortfolio, 'allocations', {
      get() {
        throw new Error('corrupt allocation data')
      },
    })

    const result = buildBatchRebalancePlan([goodPortfolio, badPortfolio], prices, feedMeta)

    expect(result.plans.map((p) => p.portfolioId)).toEqual(['batch-good'])
    expect(result.failed).toEqual([
      { portfolioId: 'batch-bad', error: 'corrupt allocation data' },
    ])
    expect(result.summary.plansGenerated).toBe(1)
    expect(result.summary.failedCount).toBe(1)
    expect(result.summary.totalPortfolios).toBe(2)
    expect(result.summary.totalTrades).toBe(result.plans[0].estimatedFees.tradeCount)
  })
})