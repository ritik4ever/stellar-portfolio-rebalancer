import { describe, it, expect } from 'vitest'
import { RiskManagementService } from '../services/riskManagements.js'
import type { PricesMap } from '../types/index.js'

const buildSeries = (
    base: number,
    returns: number[]
): Array<{ price: number, change: number, timestamp: number }> => {
    const series: Array<{ price: number, change: number, timestamp: number }> = []
    let price = base
    for (let i = 0; i < returns.length; i++) {
        price = price * (1 + returns[i])
        series.push({
            price,
            change: returns[i] * 100,
            timestamp: i + 1
        })
    }
    return series
}

const feedSeries = (
    service: RiskManagementService,
    dataset: Record<string, Array<{ price: number, change: number, timestamp: number }>>
): PricesMap => {
    const assets = Object.keys(dataset)
    const length = dataset[assets[0]].length
    let latest: PricesMap = {}

    for (let i = 0; i < length; i++) {
        const prices: PricesMap = {}
        assets.forEach(asset => {
            const point = dataset[asset][i]
            prices[asset] = {
                price: point.price,
                change: point.change,
                timestamp: point.timestamp,
                source: 'external'
            }
        })
        latest = prices
        service.updatePriceData(prices)
    }

    return latest
}

describe('RiskManagementService statistical model', () => {
    it('returns statistical metrics including VaR/CVaR/EWMA/correlation matrix', () => {
        const service = new RiskManagementService()

        const size = 140
        const btcReturns = Array.from({ length: size }, (_, i) => {
            const cycle = Math.sin(i / 7) * 0.012
            const shock = i % 24 === 0 ? -0.02 : 0
            return cycle + shock
        })
        const ethReturns = Array.from({ length: size }, (_, i) => {
            const cycle = Math.sin(i / 7 + 0.35) * 0.011
            const shock = i % 24 === 0 ? -0.018 : 0
            return cycle + shock
        })
        const xlmReturns = Array.from({ length: size }, (_, i) => {
            const cycle = Math.sin(i / 9 + 0.1) * 0.009
            const shock = i % 30 === 0 ? -0.014 : 0
            return cycle + shock
        })
        const usdcReturns = Array.from({ length: size }, (_, i) => Math.sin(i / 12) * 0.0002)

        const latest = feedSeries(service, {
            BTC: buildSeries(100, btcReturns),
            ETH: buildSeries(80, ethReturns),
            XLM: buildSeries(1, xlmReturns),
            USDC: buildSeries(1, usdcReturns)
        })

        const risk = service.analyzePortfolioRisk(
            { BTC: 35, ETH: 35, XLM: 20, USDC: 10 },
            latest
        )

        expect(risk.sampleSize).toBeGreaterThanOrEqual(30)
        expect(risk.ewmaVolatility).toBeGreaterThan(0)
        expect(risk.var95).toBeGreaterThan(0)
        expect(risk.cvar95).toBeGreaterThanOrEqual(risk.var95)
        expect(risk.maxDrawdown).toBeGreaterThanOrEqual(0)
        expect(risk.correlations.BTC.BTC).toBeCloseTo(1, 8)
        expect(risk.correlations.BTC.ETH).toBeGreaterThan(-1)
        expect(risk.correlations.BTC.ETH).toBeLessThan(1)
    })

    it('blocks rebalance with statistical model reason code on high-tail-risk data', () => {
        const service = new RiskManagementService()
        const size = 120

        const btcReturns = Array.from({ length: size }, (_, i) => (i % 2 === 0 ? 0.18 : -0.18))
        const ethReturns = Array.from({ length: size }, (_, i) => (i % 2 === 0 ? 0.17 : -0.17))
        const usdcReturns = Array.from({ length: size }, () => 0.0001)

        const latest = feedSeries(service, {
            BTC: buildSeries(100, btcReturns),
            ETH: buildSeries(60, ethReturns),
            USDC: buildSeries(1, usdcReturns)
        })

        const decision = service.shouldAllowRebalance(
            { allocations: { BTC: 60, ETH: 35, USDC: 5 } },
            latest
        )

        expect(decision.allowed).toBe(false)
        expect(decision.reasonCode).toMatch(/^STAT_MODEL_/)
        expect(decision.riskMetrics.sampleSize).toBeGreaterThanOrEqual(30)
        expect(decision.riskMetrics.var95).toBeGreaterThan(0.12)
    })

    it('matches EWMA reference value for a known series within 0.001% tolerance', () => {
        const service = new RiskManagementService()
        const lambda = 0.94
        const returns = Array.from({ length: 36 }, (_, i) => (i % 2 === 0 ? 0.012 : -0.009))
        const effectiveReturns = returns.slice(1)

        let expectedVariance = effectiveReturns[0] ** 2
        for (let i = 1; i < effectiveReturns.length; i++) {
            expectedVariance = (lambda * expectedVariance) + ((1 - lambda) * (effectiveReturns[i] ** 2))
        }
        const expectedEwma = Math.sqrt(expectedVariance)

        const latest = feedSeries(service, {
            BTC: buildSeries(100, returns.map(r => r * 1.2)),
            ETH: buildSeries(80, returns.map(r => r * 0.8)),
            XLM: buildSeries(1, returns)
        })

        const risk = service.analyzePortfolioRisk({ BTC: 0, ETH: 0, XLM: 100 }, latest)

        const tolerance = expectedEwma * 0.00001
        expect(Math.abs(risk.ewmaVolatility - expectedEwma)).toBeLessThanOrEqual(tolerance)
    })

    it('returns safe fallback metrics when fewer than MIN_RETURNS_FOR_STATS points exist', () => {
        const service = new RiskManagementService()
        const smallSampleReturns = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 0.2 : -0.2))

        const latest = feedSeries(service, {
            BTC: buildSeries(100, smallSampleReturns)
        })

        const risk = service.analyzePortfolioRisk({ BTC: 100 }, latest)
        expect(risk.sampleSize).toBeLessThan(30)
        expect(risk.ewmaVolatility).toBe(0)
        expect(risk.var95).toBe(0)
        expect(risk.cvar95).toBe(0)
        expect(risk.maxDrawdown).toBe(0)
        expect(risk.drawdownBand).toBe('normal')
    })

    it('classifies drawdown bands as normal, elevated, and critical', () => {
        const service = new RiskManagementService()
        const latest = feedSeries(service, {
            NORMAL: buildSeries(100, [0.02, -0.01, 0.015, -0.005, 0.01, -0.004, 0.006, -0.003, 0.008, -0.005, 0.006, -0.003, 0.007, -0.004, 0.005, -0.003, 0.004, -0.002, 0.003, -0.002, 0.004, -0.002, 0.003, -0.002, 0.002, -0.001, 0.002, -0.001, 0.002, -0.001, 0.002, -0.001]),
            ELEVATED: buildSeries(100, [0.03, -0.02, 0.025, -0.015, 0.02, -0.01, 0.02, -0.12, 0.01, 0.008, -0.005, 0.007, -0.004, 0.006, -0.003, 0.005, -0.003, 0.004, -0.002, 0.004, -0.002, 0.003, -0.002, 0.003, -0.001, 0.002, -0.001, 0.002, -0.001, 0.002, -0.001, 0.002]),
            CRITICAL: buildSeries(100, [0.03, -0.02, 0.025, -0.015, 0.02, -0.01, 0.01, -0.3, 0.02, 0.015, -0.01, 0.012, -0.008, 0.01, -0.006, 0.009, -0.005, 0.008, -0.004, 0.007, -0.003, 0.006, -0.003, 0.005, -0.002, 0.004, -0.002, 0.004, -0.001, 0.003, -0.001, 0.003])
        })

        const normal = service.analyzePortfolioRisk({ NORMAL: 100 }, latest)
        const elevated = service.analyzePortfolioRisk({ ELEVATED: 100 }, latest)
        const critical = service.analyzePortfolioRisk({ CRITICAL: 100 }, latest)

        expect(normal.drawdownBand).toBe('normal')
        expect(elevated.drawdownBand).toBe('elevated')
        expect(critical.drawdownBand).toBe('critical')
    })

    it('matches VaR95 and CVaR95 against known return distribution', () => {
        const service = new RiskManagementService()
        const distribution = [
            -0.05, -0.04, -0.03, -0.02, -0.015,
            -0.01, -0.009, -0.008, -0.007, -0.006,
            -0.005, -0.004, -0.003, -0.002, -0.001,
            0, 0.001, 0.002, 0.003, 0.004,
            0.005, 0.006, 0.007, 0.008, 0.009,
            0.01, 0.011, 0.012, 0.013, 0.014,
            0.015, 0.016, 0.017, 0.018, 0.019,
            0.02, 0.021, 0.022, 0.023, 0.024
        ]

        const latest = feedSeries(service, {
            BTC: buildSeries(100, distribution)
        })

        const risk = service.analyzePortfolioRisk({ BTC: 100 }, latest)

        const effectiveReturns = distribution.slice(1)
        const sorted = [...effectiveReturns].sort((a, b) => a - b)
        const tailIndex = Math.max(0, Math.floor(0.05 * sorted.length) - 1)
        const expectedVar95 = Math.max(0, -sorted[tailIndex])
        const tail = sorted.slice(0, tailIndex + 1)
        const tailMean = tail.reduce((sum, value) => sum + value, 0) / tail.length
        const expectedCvar95 = Math.max(expectedVar95, -tailMean)

        expect(risk.var95).toBeCloseTo(expectedVar95, 12)
        expect(risk.cvar95).toBeCloseTo(expectedCvar95, 12)
    })
})
