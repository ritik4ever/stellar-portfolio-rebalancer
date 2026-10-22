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

  it('matches the worked example described in Advanced.md', () => {
    const portfolio = makePortfolio(
      '42',
      { XLM: 50, USDC: 50 },
      { XLM: 48000, USDC: 4000 },
    )
    const workedPrices: PricesMap = {
      XLM: { price: 0.125, change: 0, timestamp: 1727632800000 },
      USDC: { price: 1.0, change: 0, timestamp: 1727632800000 },
    }

    const plan = buildRebalancePlan(portfolio, workedPrices, feedMeta)

    expect(plan.portfolioId).toBe('42')
    expect(plan.totalValue).toBe(10000)
    expect(plan.maxSlippagePercent).toBe(1)
    expect(plan.estimatedSlippageBps).toBe(100)
    expect(plan.estimatedFees).toEqual({
      xlm: 0.00002,
      usd: 0.0000025,
      perTradeXlm: 0.00001,
      tradeCount: 2,
    })

    const usdcAsset = plan.assets.find((a) => a.asset === 'USDC')
    const xlmAsset = plan.assets.find((a) => a.asset === 'XLM')

    expect(usdcAsset).toMatchObject({
      asset: 'USDC',
      action: 'buy',
      currentBalance: 4000,
      currentValue: 4000,
      currentAllocationPercent: 40,
      targetAllocationPercent: 50,
      targetValue: 5000,
      driftPercent: 10,
      buyAmount: 1000,
      sellAmount: 0,
      tradeValue: 1000,
      projectedBalance: 5000,
      projectedValue: 5000,
      projectedAllocationPercent: 50,
      price: 1,
    })

    expect(xlmAsset).toMatchObject({
      asset: 'XLM',
      action: 'sell',
      currentBalance: 48000,
      currentValue: 6000,
      currentAllocationPercent: 60,
      targetAllocationPercent: 50,
      targetValue: 5000,
      driftPercent: 10,
      buyAmount: 0,
      sellAmount: 8000,
      tradeValue: 1000,
      projectedBalance: 40000,
      projectedValue: 5000,
      projectedAllocationPercent: 50,
      price: 0.125,
    })

    expect(plan.projectedAllocations).toEqual({
      USDC: 50,
      XLM: 50,
    })
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