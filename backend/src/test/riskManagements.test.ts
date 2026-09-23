import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RiskManagementService } from '../services/riskManagements.js'
import type { PricesMap } from '../types/index.js'

// ── Module-level mocks ────────────────────────────────────────────────────────
// Mock side-effecting services so auto-pause tests run without a real DB or
// notification transport.

vi.mock('../services/portfolioStorage.js', () => ({
    portfolioStorage: {
        getPortfolio: vi.fn(),
        updatePortfolio: vi.fn(),
    },
}))

vi.mock('../services/notificationService.js', () => ({
    notificationService: {
        notify: vi.fn(),
    },
}))

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

    it('uses the configurable EWMA volatility alert threshold instead of a hardcoded value', () => {
        const service = new RiskManagementService()

        // ±30% daily swings drive EWMA volatility well above the default 15%
        // and below a raised 50% threshold.
        const feedSeriesBeforeRaise = () => feedSeries(service, {
            BTC: buildSeries(100, Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 0.3 : -0.3))),
            USDC: buildSeries(1, Array.from({ length: 60 }, () => 0.0001))
        })

        // Raised threshold via env: no volatility alert fires
        vi.stubEnv('CIRCUIT_BREAKER_VOLATILITY_THRESHOLD_PCT', '50')
        feedSeriesBeforeRaise()
        expect((service as any).checkVolatility('BTC')).toBeNull()

        // Default 15% (0.15) threshold: alert fires
        vi.unstubAllEnvs()
        const alert = (service as any).checkVolatility('BTC')
        expect(alert).not.toBeNull()
        expect(alert.type).toBe('volatility')
        expect(alert.asset).toBe('BTC')
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

    it('classifies overall risk levels as low, medium, high, and critical', () => {
        const service = new RiskManagementService()
        const latest: PricesMap = {
            BTC: { price: 100, change: 0, timestamp: 1, source: 'external' },
            ETH: { price: 100, change: 0, timestamp: 1, source: 'external' },
            XLM: { price: 1, change: 0, timestamp: 1, source: 'external' },
            USDC: { price: 1, change: 0, timestamp: 1, source: 'external' }
        }

        expect(service.analyzePortfolioRisk({ BTC: 25, ETH: 25, XLM: 25, USDC: 25 }, latest).overallRiskLevel).toBe('low')
        expect(service.analyzePortfolioRisk({ BTC: 40, ETH: 30, XLM: 20, USDC: 10 }, latest).overallRiskLevel).toBe('medium')
        expect(service.analyzePortfolioRisk({ BTC: 50, ETH: 25, XLM: 15, USDC: 10 }, latest).overallRiskLevel).toBe('high')
        expect(service.analyzePortfolioRisk({ BTC: 65, ETH: 15, XLM: 10, USDC: 10 }, latest).overallRiskLevel).toBe('critical')
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

// ─────────────────────────────────────────────────────────────────────────────
// CVaR/VaR auto-pause tests
// ─────────────────────────────────────────────────────────────────────────────

describe('RiskManagementService.checkCVaRVaRThresholdsAndAutoPause', () => {
    // Helpers ─────────────────────────────────────────────────────────────────

    const buildHighVolSeries = (
        service: RiskManagementService,
        size = 120
    ): PricesMap => {
        // Alternating ±18 % returns drive VaR and CVaR well above the 0.12/0.16 defaults
        const btcReturns = Array.from({ length: size }, (_, i) => (i % 2 === 0 ? 0.18 : -0.18))
        const ethReturns = Array.from({ length: size }, (_, i) => (i % 2 === 0 ? 0.17 : -0.17))
        const usdcReturns = Array.from({ length: size }, () => 0.0001)

        return feedSeries(service, {
            BTC: buildSeries(100, btcReturns),
            ETH: buildSeries(60, ethReturns),
            USDC: buildSeries(1, usdcReturns),
        })
    }

    const buildLowVolSeries = (
        service: RiskManagementService,
        size = 120
    ): PricesMap => {
        // ±0.2 % returns stay far below the default VaR/CVaR thresholds
        const returns = Array.from({ length: size }, (_, i) => (i % 2 === 0 ? 0.002 : -0.002))
        return feedSeries(service, {
            BTC: buildSeries(100, returns),
            ETH: buildSeries(60, returns),
            USDC: buildSeries(1, Array.from({ length: size }, () => 0.0001)),
        })
    }

    const PORTFOLIO_ID = 'test-portfolio-risk-pause'
    const USER_ID = 'GSTELLARADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXX'
    const ALLOCATIONS = { BTC: 60, ETH: 35, USDC: 5 }

    // Fresh mocks for each test ───────────────────────────────────────────────

    let mockGetPortfolio: ReturnType<typeof vi.fn>
    let mockUpdatePortfolio: ReturnType<typeof vi.fn>
    let mockNotify: ReturnType<typeof vi.fn>

    beforeEach(async () => {
        // Re-import the mocked modules so we get stable references each test
        const { portfolioStorage } = await import('../services/portfolioStorage.js')
        const { notificationService } = await import('../services/notificationService.js')

        mockGetPortfolio = portfolioStorage.getPortfolio as ReturnType<typeof vi.fn>
        mockUpdatePortfolio = portfolioStorage.updatePortfolio as ReturnType<typeof vi.fn>
        mockNotify = notificationService.notify as ReturnType<typeof vi.fn>

        // Provide a minimal fake portfolio by default
        mockGetPortfolio.mockResolvedValue({
            id: PORTFOLIO_ID,
            userAddress: USER_ID,
            allocations: ALLOCATIONS,
            threshold: 5,
            balances: {},
            totalValue: 0,
            createdAt: new Date().toISOString(),
            lastRebalance: new Date().toISOString(),
            version: 1,
        })
        mockUpdatePortfolio.mockResolvedValue(true)
        mockNotify.mockResolvedValue(undefined)
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    // Tests ───────────────────────────────────────────────────────────────────

    it('returns breached=true and pauses the portfolio when VaR exceeds threshold', async () => {
        const service = new RiskManagementService()
        const prices = buildHighVolSeries(service)

        const result = await service.checkCVaRVaRThresholdsAndAutoPause(
            PORTFOLIO_ID, ALLOCATIONS, prices, USER_ID
        )

        expect(result.breached).toBe(true)
        expect(result.paused).toBe(true)
        expect(result.breachType).toMatch(/^(VAR_BREACH|CVAR_BREACH)$/)
        expect(result.riskMetrics.sampleSize).toBeGreaterThanOrEqual(30)

        // Portfolio must have been updated with riskPausedUntil
        expect(mockUpdatePortfolio).toHaveBeenCalledOnce()
        const [calledId, calledUpdates] = mockUpdatePortfolio.mock.calls[0]
        expect(calledId).toBe(PORTFOLIO_ID)
        expect(calledUpdates).toHaveProperty('riskPausedUntil')
        expect(typeof calledUpdates.riskPausedUntil).toBe('string')
        // pausedUntil must be in the future
        expect(new Date(calledUpdates.riskPausedUntil).getTime()).toBeGreaterThan(Date.now())
    })

    it('sends a riskChange notification when a breach is detected', async () => {
        const service = new RiskManagementService()
        const prices = buildHighVolSeries(service)

        await service.checkCVaRVaRThresholdsAndAutoPause(
            PORTFOLIO_ID, ALLOCATIONS, prices, USER_ID
        )

        expect(mockNotify).toHaveBeenCalledOnce()
        const [notifyPayload] = mockNotify.mock.calls[0]
        expect(notifyPayload.userId).toBe(USER_ID)
        expect(notifyPayload.eventType).toBe('riskChange')
        expect(notifyPayload.title).toMatch(/auto-paused|threshold/i)
        expect(notifyPayload.message).toContain(PORTFOLIO_ID)
        expect(notifyPayload.message).toMatch(/rebalancing|paused/i)
        expect(notifyPayload.data?.autoPause?.reason).toMatch(/^(VAR_BREACH|CVAR_BREACH)$/)
        expect(notifyPayload.data?.autoPause?.pausedUntil).toBeDefined()
    })

    it('notification message includes the measured value and threshold', async () => {
        const service = new RiskManagementService()
        const prices = buildHighVolSeries(service)

        await service.checkCVaRVaRThresholdsAndAutoPause(
            PORTFOLIO_ID, ALLOCATIONS, prices, USER_ID
        )

        const [notifyPayload] = mockNotify.mock.calls[0]
        // Message should contain percentage values
        expect(notifyPayload.message).toMatch(/\d+\.\d+%/)
    })

    it('returns breached=false and does NOT pause or notify when metrics are within threshold', async () => {
        const service = new RiskManagementService()
        const prices = buildLowVolSeries(service)

        const result = await service.checkCVaRVaRThresholdsAndAutoPause(
            PORTFOLIO_ID, ALLOCATIONS, prices, USER_ID
        )

        expect(result.breached).toBe(false)
        expect(result.paused).toBe(false)
        expect(result.breachType).toBeUndefined()

        // No side effects
        expect(mockUpdatePortfolio).not.toHaveBeenCalled()
        expect(mockNotify).not.toHaveBeenCalled()
    })

    it('returns breached=false and skips everything when sample size is too small', async () => {
        const service = new RiskManagementService()

        // Only 10 price points – far below the 30-return minimum
        const smallSeries = feedSeries(service, {
            BTC: buildSeries(100, Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? 0.3 : -0.3))),
            ETH: buildSeries(60, Array.from({ length: 10 }, () => 0.001)),
            USDC: buildSeries(1, Array.from({ length: 10 }, () => 0.0001)),
        })

        const result = await service.checkCVaRVaRThresholdsAndAutoPause(
            PORTFOLIO_ID, ALLOCATIONS, smallSeries, USER_ID
        )

        expect(result.breached).toBe(false)
        expect(result.paused).toBe(false)
        expect(mockUpdatePortfolio).not.toHaveBeenCalled()
        expect(mockNotify).not.toHaveBeenCalled()
    })

    it('respects custom configurable thresholds passed to the constructor', async () => {
        // Very tight custom thresholds: any positive VaR/CVaR will trigger a breach
        const service = new RiskManagementService({ var95: 0.0001, cvar95: 0.0001 })
        const prices = buildLowVolSeries(service)

        const result = await service.checkCVaRVaRThresholdsAndAutoPause(
            PORTFOLIO_ID, ALLOCATIONS, prices, USER_ID
        )

        // With thresholds this tight, even low-volatility data should breach
        expect(result.breached).toBe(true)
        expect(result.paused).toBe(true)
        expect(mockUpdatePortfolio).toHaveBeenCalledOnce()
        expect(mockNotify).toHaveBeenCalledOnce()
    })

    it('respects a custom pause duration from constructor options', async () => {
        const pauseDurationMs = 2 * 60 * 60 * 1000 // 2 hours
        const service = new RiskManagementService({ pauseDurationMs })
        const prices = buildHighVolSeries(service)

        const beforeCall = Date.now()
        await service.checkCVaRVaRThresholdsAndAutoPause(
            PORTFOLIO_ID, ALLOCATIONS, prices, USER_ID
        )

        const [, calledUpdates] = mockUpdatePortfolio.mock.calls[0]
        const pausedTs = new Date(calledUpdates.riskPausedUntil).getTime()

        // pausedUntil should be approximately now + pauseDurationMs (within 5 s tolerance)
        expect(pausedTs).toBeGreaterThanOrEqual(beforeCall + pauseDurationMs - 5000)
        expect(pausedTs).toBeLessThanOrEqual(beforeCall + pauseDurationMs + 5000)
    })

    it('still records the pause even when the notification delivery fails', async () => {
        const service = new RiskManagementService()
        const prices = buildHighVolSeries(service)

        // Simulate notification failure
        mockNotify.mockRejectedValueOnce(new Error('SMTP offline'))

        const result = await service.checkCVaRVaRThresholdsAndAutoPause(
            PORTFOLIO_ID, ALLOCATIONS, prices, USER_ID
        )

        // Pause must have been persisted despite the notification error
        expect(result.paused).toBe(true)
        expect(mockUpdatePortfolio).toHaveBeenCalledOnce()
    })

    it('does not throw when portfolio cannot be found in storage', async () => {
        const service = new RiskManagementService()
        const prices = buildHighVolSeries(service)

        // Portfolio not in storage
        mockGetPortfolio.mockResolvedValueOnce(undefined)

        // Should resolve without throwing
        const result = await service.checkCVaRVaRThresholdsAndAutoPause(
            PORTFOLIO_ID, ALLOCATIONS, prices, USER_ID
        )

        expect(result.breached).toBe(true)
        expect(result.paused).toBe(true)
        // updatePortfolio was NOT called because the portfolio wasn't found
        expect(mockUpdatePortfolio).not.toHaveBeenCalled()
    })
})
