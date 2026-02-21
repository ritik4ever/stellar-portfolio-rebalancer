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
})
