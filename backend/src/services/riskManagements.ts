import type { PricesMap, RiskHeatmap } from '../types/index.js'
import { assetRegistryService } from './assetRegistryService.js'
import { logger } from '../utils/logger.js'
import { notificationService } from './notificationService.js'
import { buildNotificationPayload } from './notificationTemplates.js'
import { portfolioStorage } from './portfolioStorage.js'

export interface StatisticalRiskMetrics {
    ewmaVolatility: number
    var95: number
    cvar95: number
    maxDrawdown: number
    drawdownBand: 'normal' | 'elevated' | 'critical'
    correlations: Record<string, Record<string, number>>
    sampleSize: number
}

export interface RiskMetrics extends StatisticalRiskMetrics {
    volatility: number
    concentrationRisk: number
    liquidityRisk: number
    correlationRisk: number
    overallRiskLevel: 'low' | 'medium' | 'high' | 'critical'
}

export interface RiskAlert {
    type: 'volatility' | 'concentration' | 'liquidity' | 'correlation' | 'circuit_breaker'
    severity: 'warning' | 'critical'
    message: string
    asset?: string
    recommendedAction: string
    timestamp: number
}

export interface CircuitBreakerStatus {
    isTriggered: boolean
    triggerReason?: string
    cooldownUntil?: number
    triggeredAssets: string[]
}

export type RiskDecisionReasonCode =
    | 'OK'
    | 'CIRCUIT_BREAKER_ACTIVE'
    | 'CONCENTRATION_BREACH'
    | 'STAT_MODEL_EWMA_VOL_BREACH'
    | 'STAT_MODEL_VAR_BREACH'
    | 'STAT_MODEL_CVAR_BREACH'
    | 'STAT_MODEL_DRAWDOWN_BREACH'

export interface AutoPauseThresholds {
    /** VaR(95) level that triggers an auto-pause. Expressed as a decimal fraction (e.g. 0.12 = 12%). */
    var95?: number
    /** CVaR(95) level that triggers an auto-pause. Expressed as a decimal fraction (e.g. 0.16 = 16%). */
    cvar95?: number
    /** How many milliseconds to pause the portfolio for once a breach is detected. Default: 24 hours. */
    pauseDurationMs?: number
}

export interface CVaRVaRCheckResult {
    portfolioId: string
    breached: boolean
    breachType?: 'VAR_BREACH' | 'CVAR_BREACH'
    measuredValue?: number
    threshold?: number
    paused: boolean
    riskMetrics: ReturnType<RiskManagementService['analyzePortfolioRisk']>
}

type ReturnPoint = { value: number, timestamp: number }
type PricePoint = { price: number, timestamp: number }

export class RiskManagementService {
    private priceHistory: Map<string, PricePoint[]> = new Map()
    private returnSeries: Map<string, ReturnPoint[]> = new Map()
    private circuitBreakers: Map<string, CircuitBreakerStatus> = new Map()

    private readonly MAX_PRICE_HISTORY = 400
    private readonly MAX_RETURN_HISTORY = 400
    private readonly MIN_RETURNS_FOR_STATS = 30
    private readonly CORRELATION_WINDOW = 90

    private readonly EWMA_LAMBDA = 0.94
    private readonly VOLATILITY_ALERT_THRESHOLD = 0.15
    private readonly EWMA_VOL_BLOCK_THRESHOLD = 0.08
    private readonly VAR95_BLOCK_THRESHOLD = 0.12
    private readonly CVAR95_BLOCK_THRESHOLD = 0.16
    private readonly DRAWDOWN_BLOCK_THRESHOLD = 0.25
    private readonly CONCENTRATION_LIMIT = 0.70
    private readonly CIRCUIT_BREAKER_THRESHOLD = 0.20
    private readonly CIRCUIT_BREAKER_COOLDOWN = 300000 // 5 minutes

    /** Configurable CVaR/VaR auto-pause thresholds (fall back to class defaults when not set). */
    private readonly autoPauseVar95Threshold: number
    private readonly autoPauseCvar95Threshold: number
    private readonly autoPauseDurationMs: number

    constructor(autoPauseThresholds: AutoPauseThresholds = {}) {
        this.autoPauseVar95Threshold = autoPauseThresholds.var95 ?? this.VAR95_BLOCK_THRESHOLD
        this.autoPauseCvar95Threshold = autoPauseThresholds.cvar95 ?? this.CVAR95_BLOCK_THRESHOLD
        this.autoPauseDurationMs = autoPauseThresholds.pauseDurationMs ?? 24 * 60 * 60 * 1000 // 24 h

        const symbols = assetRegistryService.getSymbols(true)
        const assets = symbols.length > 0 ? symbols : ['XLM', 'BTC', 'ETH', 'USDC']
        assets.forEach(asset => {
            this.circuitBreakers.set(asset, {
                isTriggered: false,
                triggeredAssets: []
            })
        })
    }

    updatePriceData(prices: PricesMap): RiskAlert[] {
        const alerts: RiskAlert[] = []
        const timestamp = Date.now()

        Object.entries(prices).forEach(([asset, priceData]) => {
            const price = priceData?.price
            if (!Number.isFinite(price) || price <= 0) return

            if (!this.circuitBreakers.has(asset)) {
                this.circuitBreakers.set(asset, { isTriggered: false, triggeredAssets: [] })
            }

            let history = this.priceHistory.get(asset) || []
            const previous = history.length > 0 ? history[history.length - 1].price : undefined
            history.push({ price, timestamp })
            if (history.length > this.MAX_PRICE_HISTORY) history = history.slice(-this.MAX_PRICE_HISTORY)
            this.priceHistory.set(asset, history)

            if (previous && previous > 0) {
                let returns = this.returnSeries.get(asset) || []
                returns.push({ value: (price - previous) / previous, timestamp })
                if (returns.length > this.MAX_RETURN_HISTORY) returns = returns.slice(-this.MAX_RETURN_HISTORY)
                this.returnSeries.set(asset, returns)
            }

            const volatilityAlert = this.checkVolatility(asset)
            if (volatilityAlert) alerts.push(volatilityAlert)

            const circuitBreakerAlert = this.checkCircuitBreaker(asset)
            if (circuitBreakerAlert) alerts.push(circuitBreakerAlert)
        })

        return alerts
    }

    analyzePortfolioRisk(
        allocationsInput: Record<string, number>,
        _prices: PricesMap
    ): RiskMetrics {
        const weights = this.normalizeAllocations(allocationsInput)
        const assets = Object.keys(weights)

        const stats = this.computeStatisticalRiskMetrics(weights)
        const concentrationRisk = this.calculateConcentrationRisk(weights)
        const liquidityRisk = this.calculateLiquidityRisk(weights)
        const correlationRisk = this.calculateCorrelationRisk(stats.correlations)
        const volatilityScore = this.calculateVolatilityScore(stats.ewmaVolatility)

        const varScore = this.safeRatio(stats.var95, this.VAR95_BLOCK_THRESHOLD)
        const cvarScore = this.safeRatio(stats.cvar95, this.CVAR95_BLOCK_THRESHOLD)
        const drawdownScore = this.safeRatio(stats.maxDrawdown, this.DRAWDOWN_BLOCK_THRESHOLD)

        const overallRiskLevel = this.determineOverallRisk([
            concentrationRisk,
            volatilityScore,
            liquidityRisk,
            correlationRisk,
            varScore,
            cvarScore,
            drawdownScore
        ])

        const fallbackCorrelations = assets.reduce<Record<string, Record<string, number>>>((acc, assetA) => {
            acc[assetA] = {}
            assets.forEach(assetB => {
                acc[assetA][assetB] = assetA === assetB ? 1 : 0
            })
            return acc
        }, {})

        return {
            volatility: volatilityScore,
            concentrationRisk,
            liquidityRisk,
            correlationRisk,
            overallRiskLevel,
            ewmaVolatility: stats.ewmaVolatility,
            var95: stats.var95,
            cvar95: stats.cvar95,
            maxDrawdown: stats.maxDrawdown,
            drawdownBand: stats.drawdownBand,
            correlations: Object.keys(stats.correlations).length > 0 ? stats.correlations : fallbackCorrelations,
            sampleSize: stats.sampleSize
        }
    }

    shouldAllowRebalance(portfolio: { allocations: Record<string, number> }, prices: PricesMap): {
        allowed: boolean
        reason?: string
        reasonCode?: RiskDecisionReasonCode
        alerts: RiskAlert[]
        riskMetrics: RiskMetrics
    } {
        const fallbackMetrics = this.analyzePortfolioRisk(portfolio?.allocations || {}, prices)
        const alerts: RiskAlert[] = []

        const hasActiveCircuitBreaker = Array.from(this.circuitBreakers.values())
            .some(cb => cb.isTriggered && (cb.cooldownUntil || 0) > Date.now())

        if (hasActiveCircuitBreaker) {
            logger.warn('[RISK] Rebalance blocked by circuit breaker', {
                reasonCode: 'CIRCUIT_BREAKER_ACTIVE',
                activeBreakers: Array.from(this.circuitBreakers.entries())
                    .filter(([, cb]) => cb.isTriggered)
                    .map(([asset]) => asset)
            })
            return {
                allowed: false,
                reason: 'Circuit breaker active due to high market volatility',
                reasonCode: 'CIRCUIT_BREAKER_ACTIVE',
                alerts: [{
                    type: 'circuit_breaker',
                    severity: 'critical',
                    message: 'Rebalancing temporarily suspended due to circuit breaker',
                    recommendedAction: 'Wait for market conditions to stabilize',
                    timestamp: Date.now()
                }],
                riskMetrics: fallbackMetrics
            }
        }

        const riskMetrics = fallbackMetrics

        if (riskMetrics.concentrationRisk > 0.9) {
            logger.warn('[RISK] Rebalance blocked by concentration', {
                reasonCode: 'CONCENTRATION_BREACH',
                concentrationRisk: riskMetrics.concentrationRisk
            })
            return {
                allowed: false,
                reason: 'Portfolio concentration risk exceeds policy limit',
                reasonCode: 'CONCENTRATION_BREACH',
                alerts: [{
                    type: 'concentration',
                    severity: 'critical',
                    message: 'Concentration exceeds allowed portfolio limit',
                    recommendedAction: 'Reduce dominant asset weight before rebalancing',
                    timestamp: Date.now()
                }],
                riskMetrics
            }
        }

        if (riskMetrics.sampleSize >= this.MIN_RETURNS_FOR_STATS && riskMetrics.ewmaVolatility > this.EWMA_VOL_BLOCK_THRESHOLD) {
            alerts.push({
                type: 'volatility',
                severity: 'critical',
                message: `EWMA volatility breach: ${(riskMetrics.ewmaVolatility * 100).toFixed(2)}%`,
                recommendedAction: 'Pause rebalance until realized volatility declines',
                timestamp: Date.now()
            })
            logger.warn('[RISK] Rebalance blocked by EWMA volatility', {
                reasonCode: 'STAT_MODEL_EWMA_VOL_BREACH',
                ewmaVolatility: riskMetrics.ewmaVolatility,
                threshold: this.EWMA_VOL_BLOCK_THRESHOLD
            })
            return {
                allowed: false,
                reason: 'Rebalance blocked by statistical volatility model',
                reasonCode: 'STAT_MODEL_EWMA_VOL_BREACH',
                alerts,
                riskMetrics
            }
        }

        if (riskMetrics.sampleSize >= this.MIN_RETURNS_FOR_STATS && riskMetrics.var95 > this.VAR95_BLOCK_THRESHOLD) {
            alerts.push({
                type: 'volatility',
                severity: 'critical',
                message: `VaR(95) breach: ${(riskMetrics.var95 * 100).toFixed(2)}%`,
                recommendedAction: 'Reduce risk assets or wait for calmer market regime',
                timestamp: Date.now()
            })
            logger.warn('[RISK] Rebalance blocked by VaR', {
                reasonCode: 'STAT_MODEL_VAR_BREACH',
                var95: riskMetrics.var95,
                threshold: this.VAR95_BLOCK_THRESHOLD
            })
            return {
                allowed: false,
                reason: 'Rebalance blocked by VaR limit',
                reasonCode: 'STAT_MODEL_VAR_BREACH',
                alerts,
                riskMetrics
            }
        }

        if (riskMetrics.sampleSize >= this.MIN_RETURNS_FOR_STATS && riskMetrics.cvar95 > this.CVAR95_BLOCK_THRESHOLD) {
            alerts.push({
                type: 'volatility',
                severity: 'critical',
                message: `CVaR(95) breach: ${(riskMetrics.cvar95 * 100).toFixed(2)}%`,
                recommendedAction: 'Reduce downside tail-risk before rebalancing',
                timestamp: Date.now()
            })
            logger.warn('[RISK] Rebalance blocked by CVaR', {
                reasonCode: 'STAT_MODEL_CVAR_BREACH',
                cvar95: riskMetrics.cvar95,
                threshold: this.CVAR95_BLOCK_THRESHOLD
            })
            return {
                allowed: false,
                reason: 'Rebalance blocked by CVaR limit',
                reasonCode: 'STAT_MODEL_CVAR_BREACH',
                alerts,
                riskMetrics
            }
        }

        if (riskMetrics.sampleSize >= this.MIN_RETURNS_FOR_STATS && riskMetrics.maxDrawdown > this.DRAWDOWN_BLOCK_THRESHOLD) {
            alerts.push({
                type: 'volatility',
                severity: 'critical',
                message: `Max drawdown breach: ${(riskMetrics.maxDrawdown * 100).toFixed(2)}%`,
                recommendedAction: 'Avoid additional turnover while drawdown band is critical',
                timestamp: Date.now()
            })
            logger.warn('[RISK] Rebalance blocked by drawdown', {
                reasonCode: 'STAT_MODEL_DRAWDOWN_BREACH',
                maxDrawdown: riskMetrics.maxDrawdown,
                threshold: this.DRAWDOWN_BLOCK_THRESHOLD
            })
            return {
                allowed: false,
                reason: 'Rebalance blocked by drawdown guardrail',
                reasonCode: 'STAT_MODEL_DRAWDOWN_BREACH',
                alerts,
                riskMetrics
            }
        }

        if (riskMetrics.concentrationRisk > 0.8) {
            alerts.push({
                type: 'concentration',
                severity: 'warning',
                message: 'High concentration risk detected',
                recommendedAction: 'Consider reducing allocation to dominant assets',
                timestamp: Date.now()
            })
        }

        logger.info('[RISK] Rebalance allowed', {
            reasonCode: 'OK',
            overallRiskLevel: riskMetrics.overallRiskLevel,
            alertsCount: alerts.length
        })

        return {
            allowed: true,
            reasonCode: 'OK',
            alerts,
            riskMetrics
        }
    }

    /**
     * Evaluates CVaR(95) and VaR(95) against the configured auto-pause thresholds.
     *
     * When either metric exceeds its threshold:
     *  - Marks the portfolio as paused until `now + autoPauseDurationMs` by setting
     *    `riskPausedUntil` on the portfolio record.
     *  - Sends a `riskChange` notification to `userId` explaining the auto-pause.
     *
     * When neither metric is breached the portfolio is left unchanged and no
     * notification is sent.
     *
     * @param portfolioId  The portfolio to evaluate and potentially pause.
     * @param allocations  Current target allocations (weights or percentages).
     * @param prices       Latest price data used for risk calculation.
     * @param userId       Stellar address of the portfolio owner – used for notifications.
     * @returns            A `CVaRVaRCheckResult` describing the outcome.
     */
    async checkCVaRVaRThresholdsAndAutoPause(
        portfolioId: string,
        allocations: Record<string, number>,
        prices: PricesMap,
        userId: string
    ): Promise<CVaRVaRCheckResult> {
        const riskMetrics = this.analyzePortfolioRisk(allocations, prices)

        // Only run the threshold check once we have enough data for reliable stats
        if (riskMetrics.sampleSize < this.MIN_RETURNS_FOR_STATS) {
            logger.debug('[RISK] Skipping CVaR/VaR auto-pause check – insufficient sample size', {
                portfolioId,
                sampleSize: riskMetrics.sampleSize,
                minRequired: this.MIN_RETURNS_FOR_STATS
            })
            return { portfolioId, breached: false, paused: false, riskMetrics }
        }

        // Determine which metric (if any) is breached – VaR is checked first
        let breachType: 'VAR_BREACH' | 'CVAR_BREACH' | undefined
        let measuredValue: number | undefined
        let threshold: number | undefined

        if (riskMetrics.var95 > this.autoPauseVar95Threshold) {
            breachType = 'VAR_BREACH'
            measuredValue = riskMetrics.var95
            threshold = this.autoPauseVar95Threshold
        } else if (riskMetrics.cvar95 > this.autoPauseCvar95Threshold) {
            breachType = 'CVAR_BREACH'
            measuredValue = riskMetrics.cvar95
            threshold = this.autoPauseCvar95Threshold
        }

        if (!breachType) {
            // All clear – no action needed
            return { portfolioId, breached: false, paused: false, riskMetrics }
        }

        // ── Breach detected ──────────────────────────────────────────────────────
        const pausedUntil = new Date(Date.now() + this.autoPauseDurationMs).toISOString()

        logger.warn('[RISK] CVaR/VaR threshold breached – auto-pausing portfolio', {
            portfolioId,
            breachType,
            measuredValue,
            threshold,
            pausedUntil
        })

        // 1. Persist the pause flag on the portfolio
        try {
            const portfolio = await portfolioStorage.getPortfolio(portfolioId)
            if (portfolio) {
                await portfolioStorage.updatePortfolio(portfolioId, { riskPausedUntil: pausedUntil })
            } else {
                logger.warn('[RISK] Portfolio not found for auto-pause', { portfolioId })
            }
        } catch (err) {
            logger.error('[RISK] Failed to persist auto-pause on portfolio', {
                portfolioId,
                error: err instanceof Error ? err.message : String(err)
            })
        }

        // 2. Send a notification explaining the pause
        try {
            const metricLabel = breachType === 'VAR_BREACH' ? 'VaR(95)' : 'CVaR(95)'
            const measuredPct = `${(measuredValue! * 100).toFixed(2)}%`
            const thresholdPct = `${(threshold! * 100).toFixed(2)}%`

            const payload = buildNotificationPayload(userId, {
                eventType: 'riskChange',
                data: {
                    portfolioId,
                    oldLevel: riskMetrics.overallRiskLevel,
                    newLevel: 'critical',
                    autoPause: {
                        reason: breachType,
                        measuredValue: measuredPct,
                        threshold: thresholdPct,
                        pausedUntil
                    }
                }
            })

            await notificationService.notify(payload)

            logger.info('[RISK] Auto-pause notification sent', {
                portfolioId,
                userId,
                metricLabel,
                measuredValue: measuredPct,
                threshold: thresholdPct
            })
        } catch (err) {
            // Notification failure must never prevent the pause from being recorded
            logger.error('[RISK] Failed to send auto-pause notification', {
                portfolioId,
                userId,
                error: err instanceof Error ? err.message : String(err)
            })
        }

        return {
            portfolioId,
            breached: true,
            breachType,
            measuredValue,
            threshold,
            paused: true,
            riskMetrics
        }
    }

    getCircuitBreakerStatus(): Record<string, CircuitBreakerStatus> {
        const status: Record<string, CircuitBreakerStatus> = {}

        this.circuitBreakers.forEach((value, key) => {
            if (value.isTriggered && value.cooldownUntil && value.cooldownUntil < Date.now()) {
                value.isTriggered = false
                value.triggerReason = undefined
                value.cooldownUntil = undefined
                value.triggeredAssets = []
            }
            status[key] = { ...value }
        })

        return status
    }

    /**
     * Resets a tripped circuit breaker for a given portfolio or asset (or all if not specified).
     * @param targetId Portfolio ID, asset symbol, or undefined for all circuit breakers.
     */
    resetCircuitBreaker(targetId?: string): { resetCount: number; resetTargets: string[] } {
        const resetTargets: string[] = []

        if (targetId) {
            const assetKey = targetId.toUpperCase()
            if (this.circuitBreakers.has(assetKey)) {
                const cb = this.circuitBreakers.get(assetKey)!
                cb.isTriggered = false
                cb.triggerReason = undefined
                cb.cooldownUntil = undefined
                cb.triggeredAssets = []
                resetTargets.push(assetKey)
            } else {
                this.circuitBreakers.set(targetId, {
                    isTriggered: false,
                    triggeredAssets: []
                })
                resetTargets.push(targetId)
            }
        } else {
            this.circuitBreakers.forEach((cb, key) => {
                cb.isTriggered = false
                cb.triggerReason = undefined
                cb.cooldownUntil = undefined
                cb.triggeredAssets = []
                resetTargets.push(key)
            })
        }

        logger.info('[RISK] Circuit breaker reset', { targetId, resetTargets })
        return { resetCount: resetTargets.length, resetTargets }
    }

    getRecommendations(riskMetrics: RiskMetrics, allocationsInput: Record<string, number>): string[] {
        const allocations = this.normalizeAllocations(allocationsInput)
        const recommendations: string[] = []

        if (riskMetrics.concentrationRisk > 0.6) {
            const maxAsset = Object.entries(allocations)
                .reduce((max, [asset, weight]) => weight > max.weight ? { asset, weight } : max, { asset: '', weight: 0 })
            recommendations.push(`Consider reducing ${maxAsset.asset} allocation to improve diversification`)
        }

        if (riskMetrics.var95 > this.VAR95_BLOCK_THRESHOLD * 0.8) {
            recommendations.push('Portfolio VaR is elevated. Reduce directional concentration or hedge downside')
        }

        if (riskMetrics.cvar95 > this.CVAR95_BLOCK_THRESHOLD * 0.8) {
            recommendations.push('Portfolio tail-risk is elevated. Reduce high-volatility exposures')
        }

        if (riskMetrics.drawdownBand !== 'normal') {
            recommendations.push('Drawdown risk band is elevated. Avoid aggressive rebalance turnover')
        }

        if (riskMetrics.correlationRisk > 0.8) {
            recommendations.push('Assets are highly correlated. Diversify into lower-correlation assets')
        }

        if (recommendations.length === 0) {
            recommendations.push('Portfolio risk levels are within acceptable statistical bounds')
        }

        return recommendations
    }

    calculateRiskHeatmap(
        allocationsInput: Record<string, number>,
        _prices: PricesMap
    ): RiskHeatmap {
        const weights = this.normalizeAllocations(allocationsInput || {})
        const stats = this.computeStatisticalRiskMetrics(weights)
        
        const concentrationRisk = this.calculateConcentrationRisk(weights)
        const volatilityScore = this.calculateVolatilityScore(stats.ewmaVolatility)
        const drawdownScore = this.safeRatio(stats.maxDrawdown, this.DRAWDOWN_BLOCK_THRESHOLD)

        const normConcentration = Math.min(1, Math.max(0, concentrationRisk))
        const normVolatility = Math.min(1, Math.max(0, volatilityScore))
        const normDrawdown = Math.min(1, Math.max(0, drawdownScore))

        const getLevel = (score: number): 'low' | 'medium' | 'high' => {
            if (score > 0.8) return 'high'
            if (score > 0.4) return 'medium'
            return 'low'
        }

        return {
            concentration: {
                score: Number(normConcentration.toFixed(4)),
                level: getLevel(normConcentration)
            },
            volatility: {
                score: Number(normVolatility.toFixed(4)),
                level: getLevel(normVolatility)
            },
            drawdown: {
                score: Number(normDrawdown.toFixed(4)),
                level: getLevel(normDrawdown)
            }
        }
    }

    private checkVolatility(asset: string): RiskAlert | null {
        const series = this.returnSeries.get(asset)
        if (!series || series.length < 10) return null

        const ewmaVol = this.computeEwmaVolatility(series.map(p => p.value).slice(-30))
        if (ewmaVol <= this.VOLATILITY_ALERT_THRESHOLD) return null

        return {
            type: 'volatility',
            severity: ewmaVol > this.VOLATILITY_ALERT_THRESHOLD * 1.5 ? 'critical' : 'warning',
            message: `High EWMA volatility detected in ${asset} (${(ewmaVol * 100).toFixed(2)}%)`,
            asset,
            recommendedAction: 'Consider reducing exposure or widening rebalance cooldown',
            timestamp: Date.now()
        }
    }

    private checkCircuitBreaker(asset: string): RiskAlert | null {
        const history = this.priceHistory.get(asset)
        if (!history || history.length < 2) return null

        const currentPrice = history[history.length - 1].price
        const previousPrice = history[history.length - 2].price
        const priceChange = Math.abs(currentPrice - previousPrice) / previousPrice

        if (priceChange <= this.CIRCUIT_BREAKER_THRESHOLD) return null

        const circuitBreaker = this.circuitBreakers.get(asset)
        if (circuitBreaker) {
            circuitBreaker.isTriggered = true
            circuitBreaker.triggerReason = `${(priceChange * 100).toFixed(1)}% price movement`
            circuitBreaker.cooldownUntil = Date.now() + this.CIRCUIT_BREAKER_COOLDOWN
            circuitBreaker.triggeredAssets = [asset]
        }

        return {
            type: 'circuit_breaker',
            severity: 'critical',
            message: `Circuit breaker triggered for ${asset} due to ${(priceChange * 100).toFixed(1)}% price movement`,
            asset,
            recommendedAction: 'Rebalancing temporarily suspended for this asset',
            timestamp: Date.now()
        }
    }

    private normalizeAllocations(
        allocationsInput: Record<string, number>
    ): Record<string, number> {
        let raw: Record<string, number> = { ...allocationsInput }

        const cleaned = Object.entries(raw).reduce<Record<string, number>>((acc, [asset, value]) => {
            const numeric = Number(value)
            if (!Number.isFinite(numeric) || numeric <= 0) return acc
            acc[asset] = numeric
            return acc
        }, {})

        const sum = Object.values(cleaned).reduce((total, value) => total + value, 0)
        if (sum <= 0) return {}

        const asFraction = sum > 1.5
        return Object.entries(cleaned).reduce<Record<string, number>>((acc, [asset, value]) => {
            acc[asset] = asFraction ? value / sum : value / sum
            return acc
        }, {})
    }

    private computeStatisticalRiskMetrics(weights: Record<string, number>): StatisticalRiskMetrics {
        const assets = Object.keys(weights)
        if (assets.length === 0) {
            return {
                ewmaVolatility: 0,
                var95: 0,
                cvar95: 0,
                maxDrawdown: 0,
                drawdownBand: 'normal',
                correlations: {},
                sampleSize: 0
            }
        }

        const windowedReturns = assets.reduce<Record<string, number[]>>((acc, asset) => {
            const series = this.returnSeries.get(asset) || []
            acc[asset] = series.map(point => point.value).slice(-this.CORRELATION_WINDOW)
            return acc
        }, {})

        const sampleSize = Math.min(...Object.values(windowedReturns).map(series => series.length))
        if (!Number.isFinite(sampleSize) || sampleSize <= 1) {
            return {
                ewmaVolatility: 0,
                var95: 0,
                cvar95: 0,
                maxDrawdown: 0,
                drawdownBand: 'normal',
                correlations: this.buildIdentityCorrelations(assets),
                sampleSize: 0
            }
        }

        const aligned = assets.reduce<Record<string, number[]>>((acc, asset) => {
            acc[asset] = windowedReturns[asset].slice(-sampleSize)
            return acc
        }, {})

        if (sampleSize < this.MIN_RETURNS_FOR_STATS) {
            return {
                ewmaVolatility: 0,
                var95: 0,
                cvar95: 0,
                maxDrawdown: 0,
                drawdownBand: 'normal',
                correlations: this.buildIdentityCorrelations(assets),
                sampleSize
            }
        }

        const portfolioReturns = this.calculatePortfolioReturns(weights, aligned, sampleSize)
        const ewmaVolatility = this.computeEwmaVolatility(portfolioReturns)
        const { var95, cvar95 } = this.calculateVaRAndCVaR(portfolioReturns)
        const maxDrawdown = this.calculateMaxDrawdown(portfolioReturns)
        const correlations = this.buildCorrelationMatrix(assets, aligned, sampleSize)

        return {
            ewmaVolatility,
            var95,
            cvar95,
            maxDrawdown,
            drawdownBand: maxDrawdown > 0.20 ? 'critical' : maxDrawdown > 0.10 ? 'elevated' : 'normal',
            correlations,
            sampleSize
        }
    }

    private buildIdentityCorrelations(assets: string[]): Record<string, Record<string, number>> {
        return assets.reduce<Record<string, Record<string, number>>>((acc, assetA) => {
            acc[assetA] = {}
            assets.forEach(assetB => {
                acc[assetA][assetB] = assetA === assetB ? 1 : 0
            })
            return acc
        }, {})
    }

    private calculatePortfolioReturns(
        weights: Record<string, number>,
        alignedReturns: Record<string, number[]>,
        sampleSize: number
    ): number[] {
        const assets = Object.keys(weights)
        const returns: number[] = []
        for (let i = 0; i < sampleSize; i++) {
            let value = 0
            assets.forEach(asset => {
                value += (weights[asset] || 0) * (alignedReturns[asset]?.[i] || 0)
            })
            returns.push(value)
        }
        return returns
    }

    private computeEwmaVolatility(returns: number[]): number {
        if (returns.length === 0) return 0
        let variance = Math.pow(returns[0], 2)
        for (let i = 1; i < returns.length; i++) {
            const squared = Math.pow(returns[i], 2)
            variance = this.EWMA_LAMBDA * variance + (1 - this.EWMA_LAMBDA) * squared
        }
        return Math.sqrt(Math.max(variance, 0))
    }

    private calculateVaRAndCVaR(returns: number[]): { var95: number, cvar95: number } {
        if (returns.length === 0) return { var95: 0, cvar95: 0 }
        const sorted = [...returns].sort((a, b) => a - b)
        const tailIndex = Math.max(0, Math.floor(0.05 * sorted.length) - 1)
        const varCut = sorted[tailIndex]
        const var95 = Math.max(0, -varCut)

        const tail = sorted.slice(0, tailIndex + 1)
        const tailMean = tail.length > 0
            ? tail.reduce((sum, value) => sum + value, 0) / tail.length
            : 0
        const cvar95 = Math.max(var95, -tailMean)
        return { var95, cvar95 }
    }

    private calculateMaxDrawdown(returns: number[]): number {
        if (returns.length === 0) return 0
        let cumulative = 1
        let peak = 1
        let maxDrawdown = 0

        returns.forEach(r => {
            cumulative *= (1 + r)
            if (cumulative > peak) peak = cumulative
            const drawdown = peak > 0 ? (peak - cumulative) / peak : 0
            if (drawdown > maxDrawdown) maxDrawdown = drawdown
        })

        return Math.max(0, maxDrawdown)
    }

    private buildCorrelationMatrix(
        assets: string[],
        alignedReturns: Record<string, number[]>,
        sampleSize: number
    ): Record<string, Record<string, number>> {
        const matrix: Record<string, Record<string, number>> = {}
        assets.forEach(assetA => {
            matrix[assetA] = {}
            assets.forEach(assetB => {
                if (assetA === assetB) {
                    matrix[assetA][assetB] = 1
                } else {
                    matrix[assetA][assetB] = this.calculatePearson(
                        alignedReturns[assetA].slice(-sampleSize),
                        alignedReturns[assetB].slice(-sampleSize)
                    )
                }
            })
        })
        return matrix
    }

    private calculatePearson(seriesA: number[], seriesB: number[]): number {
        const n = Math.min(seriesA.length, seriesB.length)
        if (n < 2) return 0

        const meanA = seriesA.reduce((sum, value) => sum + value, 0) / n
        const meanB = seriesB.reduce((sum, value) => sum + value, 0) / n

        let numerator = 0
        let varA = 0
        let varB = 0
        for (let i = 0; i < n; i++) {
            const da = seriesA[i] - meanA
            const db = seriesB[i] - meanB
            numerator += da * db
            varA += da * da
            varB += db * db
        }

        const denominator = Math.sqrt(varA * varB)
        if (denominator === 0) return 0
        return Math.max(-1, Math.min(1, numerator / denominator))
    }

    private calculateConcentrationRisk(weights: Record<string, number>): number {
        const maxWeight = Math.max(0, ...Object.values(weights))
        return Math.min(1, this.safeRatio(maxWeight, this.CONCENTRATION_LIMIT))
    }

    private calculateVolatilityScore(ewmaVolatility: number): number {
        return Math.min(1, this.safeRatio(ewmaVolatility, this.EWMA_VOL_BLOCK_THRESHOLD))
    }

    private calculateLiquidityRisk(weights: Record<string, number>): number {
        const liquidityScores: Record<string, number> = {
            USDC: 0.95,
            BTC: 0.90,
            ETH: 0.85,
            XLM: 0.70
        }

        let weightedLiquidity = 0
        Object.entries(weights).forEach(([asset, weight]) => {
            const liquidityScore = liquidityScores[asset] ?? 0.5
            weightedLiquidity += liquidityScore * weight
        })

        return 1 - Math.min(1, Math.max(0, weightedLiquidity))
    }

    private calculateCorrelationRisk(correlations: Record<string, Record<string, number>>): number {
        const assets = Object.keys(correlations)
        if (assets.length < 2) return 0

        let sum = 0
        let count = 0
        assets.forEach((assetA, indexA) => {
            for (let indexB = indexA + 1; indexB < assets.length; indexB++) {
                const assetB = assets[indexB]
                const corr = Math.abs(correlations[assetA]?.[assetB] ?? 0)
                sum += corr
                count++
            }
        })

        return count > 0 ? Math.min(1, sum / count) : 0
    }

    private determineOverallRisk(riskScores: number[]): 'low' | 'medium' | 'high' | 'critical' {
        const avgRisk = riskScores.reduce((sum, score) => sum + score, 0) / riskScores.length
        const maxRisk = Math.max(...riskScores)

        if (maxRisk > 0.9 || avgRisk > 0.8) return 'critical'
        if (maxRisk > 0.7 || avgRisk > 0.6) return 'high'
        if (maxRisk > 0.4 || avgRisk > 0.3) return 'medium'
        return 'low'
    }

    private safeRatio(numerator: number, denominator: number): number {
        if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0
        return numerator / denominator
    }
}
