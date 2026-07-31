import { describe, it, expect } from 'vitest'
import {
    buildPortfolioSummaries,
    buildPortfolioSummary,
    classifyDrift,
    computeMaxDriftPercent,
    computeTotalValueUsd,
    DRIFT_WARNING_RATIO
} from '../services/portfolioSummary.js'
import type { Portfolio, PricesMap } from '../types/index.js'

function priceMap(prices: Record<string, number>): PricesMap {
    return Object.fromEntries(
        Object.entries(prices).map(([asset, price]) => [asset, { price, change: 0, timestamp: 0 }])
    )
}

function portfolio(overrides: Partial<Portfolio> = {}): Portfolio {
    return {
        id: 'p-1',
        userAddress: 'GTESTADDRESS',
        allocations: { XLM: 50, USDC: 50 },
        threshold: 5,
        balances: { XLM: 100, USDC: 50 },
        totalValue: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        lastRebalance: '2026-01-02T00:00:00.000Z',
        version: 1,
        ...overrides
    }
}

// XLM at $0.50 and USDC at $1.00 makes a 100 XLM / 50 USDC portfolio exactly
// 50/50 by value, which keeps the drift arithmetic below easy to follow.
const PRICES = priceMap({ XLM: 0.5, USDC: 1 })

describe('computeTotalValueUsd', () => {
    it('values every held asset at its current price', () => {
        expect(computeTotalValueUsd(portfolio(), PRICES)).toBe(100)
    })

    it('treats an unpriced asset as zero rather than assuming a price', () => {
        const p = portfolio({ allocations: { XLM: 50, MISSING: 50 }, balances: { XLM: 100, MISSING: 999 } })
        expect(computeTotalValueUsd(p, PRICES)).toBe(50)
    })

    it('returns zero for a portfolio holding nothing', () => {
        expect(computeTotalValueUsd(portfolio({ balances: {} }), PRICES)).toBe(0)
    })

    it('counts a held asset that has no target allocation', () => {
        const p = portfolio({ allocations: { XLM: 100 }, balances: { XLM: 100, USDC: 25 } })
        expect(computeTotalValueUsd(p, PRICES)).toBe(75)
    })
})

describe('computeMaxDriftPercent', () => {
    it('is zero when current weights match targets', () => {
        const total = computeTotalValueUsd(portfolio(), PRICES)
        expect(computeMaxDriftPercent(portfolio(), PRICES, total)).toBe(0)
    })

    it('reports the largest gap in percentage points', () => {
        // 60 USD of XLM and 40 USDC against a 50/50 target is 10pp on both legs.
        const p = portfolio({ balances: { XLM: 120, USDC: 40 } })
        const total = computeTotalValueUsd(p, PRICES)
        expect(total).toBe(100)
        expect(computeMaxDriftPercent(p, PRICES, total)).toBe(10)
    })

    it('counts an untargeted holding as full drift against a zero target', () => {
        const p = portfolio({ allocations: { XLM: 100 }, balances: { XLM: 100, USDC: 50 } })
        const total = computeTotalValueUsd(p, PRICES)
        expect(computeMaxDriftPercent(p, PRICES, total)).toBe(50)
    })

    it('is zero when the portfolio has no value to weight against', () => {
        expect(computeMaxDriftPercent(portfolio({ balances: {} }), PRICES, 0)).toBe(0)
    })
})

describe('classifyDrift', () => {
    it('is ok below the warning band', () => {
        expect(classifyDrift(2, 5)).toBe('ok')
    })

    it('enters warning at half the threshold', () => {
        expect(classifyDrift(5 * DRIFT_WARNING_RATIO, 5)).toBe('warning')
    })

    it('stays warning at exactly the threshold', () => {
        // The auto-rebalancer treats drift as exceeded only past the threshold,
        // so the boundary itself must not read as critical here either.
        expect(classifyDrift(5, 5)).toBe('warning')
    })

    it('is critical past the threshold', () => {
        expect(classifyDrift(5.01, 5)).toBe('critical')
    })

    it('scales the bands to each portfolio threshold', () => {
        expect(classifyDrift(6, 20)).toBe('ok')
        expect(classifyDrift(6, 10)).toBe('warning')
        expect(classifyDrift(6, 2)).toBe('critical')
    })

    it('treats any drift as critical when the threshold is zero', () => {
        expect(classifyDrift(0, 0)).toBe('ok')
        expect(classifyDrift(0.1, 0)).toBe('critical')
    })
})

describe('buildPortfolioSummary', () => {
    it('projects the dashboard fields for a balanced portfolio', () => {
        expect(buildPortfolioSummary(portfolio({ name: 'Core' }), PRICES)).toEqual({
            id: 'p-1',
            name: 'Core',
            total_value_usd: 100,
            drift_status: 'ok',
            last_rebalanced: '2026-01-02T00:00:00.000Z'
        })
    })

    it('reports a null name when the portfolio was never named', () => {
        expect(buildPortfolioSummary(portfolio(), PRICES).name).toBeNull()
    })

    it('surfaces each drift band from real balances', () => {
        const ok = portfolio({ balances: { XLM: 100, USDC: 50 } })
        const warning = portfolio({ balances: { XLM: 106, USDC: 47 } })
        const critical = portfolio({ balances: { XLM: 160, USDC: 20 } })

        expect(buildPortfolioSummary(ok, PRICES).drift_status).toBe('ok')
        expect(buildPortfolioSummary(warning, PRICES).drift_status).toBe('warning')
        expect(buildPortfolioSummary(critical, PRICES).drift_status).toBe('critical')
    })

    it('reports an empty portfolio as ok with no value', () => {
        const summary = buildPortfolioSummary(portfolio({ balances: {} }), PRICES)
        expect(summary.total_value_usd).toBe(0)
        expect(summary.drift_status).toBe('ok')
    })
})

describe('buildPortfolioSummaries', () => {
    it('projects every portfolio against one shared price map', () => {
        const summaries = buildPortfolioSummaries(
            [portfolio({ id: 'a' }), portfolio({ id: 'b', balances: { XLM: 160, USDC: 20 } })],
            PRICES
        )

        expect(summaries.map((s) => s.id)).toEqual(['a', 'b'])
        expect(summaries.map((s) => s.drift_status)).toEqual(['ok', 'critical'])
    })

    it('returns an empty array for no portfolios', () => {
        expect(buildPortfolioSummaries([], PRICES)).toEqual([])
    })
})
