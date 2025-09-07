import type { PricesMap, PriceData } from '../types/index.js'

export interface RiskMetrics {
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

export class RiskManagementService {
    private priceHistory: Map<string, Array<{ price: number, timestamp: number }>> = new Map()
    private circuitBreakers: Map<string, CircuitBreakerStatus> = new Map()
    private readonly MAX_PRICE_HISTORY = 100
    private readonly VOLATILITY_THRESHOLD = 0.15 // 15%
    private readonly CONCENTRATION_LIMIT = 0.70 // 70% max allocation
    private readonly CIRCUIT_BREAKER_THRESHOLD = 0.20 // 20% price move
    private readonly CIRCUIT_BREAKER_COOLDOWN = 300000 // 5 minutes

    constructor() {
        // Initialize circuit breakers for all assets
        ['XLM', 'BTC', 'ETH', 'USDC'].forEach(asset => {
            this.circuitBreakers.set(asset, {
                isTriggered: false,
                triggeredAssets: []
            })
        })
    }

    /**
     * Update price history and check for risk events
     */
    updatePriceData(prices: PricesMap): RiskAlert[] {
        const alerts: RiskAlert[] = []
        const timestamp = Date.now()

        Object.entries(prices).forEach(([asset, priceData]) => {
            // Update price history
            let history = this.priceHistory.get(asset) || []
            history.push({ price: priceData.price, timestamp })

            // Keep only recent history
            if (history.length > this.MAX_PRICE_HISTORY) {
                history = history.slice(-this.MAX_PRICE_HISTORY)
            }
            this.priceHistory.set(asset, history)

            // Check for volatility alerts
            const volatilityAlert = this.checkVolatility(asset, history)
            if (volatilityAlert) alerts.push(volatilityAlert)

            // Check for circuit breaker triggers
            const circuitBreakerAlert = this.checkCircuitBreaker(asset, history)
            if (circuitBreakerAlert) alerts.push(circuitBreakerAlert)
        })

        return alerts
    }

    /**
     * Analyze portfolio risk metrics
     */
    analyzePortfolioRisk(allocations: Record<string, number>, prices: PricesMap): RiskMetrics {
        const totalValue = Object.entries(allocations).reduce((sum, [asset, allocation]) => {
            const price = prices[asset]?.price || 0
            return sum + (allocation * price)
        }, 0)

        // Calculate concentration risk
        const concentrationRisk = this.calculateConcentrationRisk(allocations, totalValue)

        // Calculate volatility risk
        const volatilityRisk = this.calculateVolatilityRisk(Object.keys(allocations))

        // Calculate liquidity risk (simplified)
        const liquidityRisk = this.calculateLiquidityRisk(allocations)

        // Calculate correlation risk (simplified)
        const correlationRisk = this.calculateCorrelationRisk(Object.keys(allocations))

        // Overall risk assessment
        const overallRiskLevel = this.determineOverallRisk([
            concentrationRisk,
            volatilityRisk,
            liquidityRisk,
            correlationRisk
        ])

        return {
            volatility: volatilityRisk,
            concentrationRisk,
            liquidityRisk,
            correlationRisk,
            overallRiskLevel
        }
    }

    /**
     * Check if rebalancing should be allowed based on risk conditions
     */
    shouldAllowRebalance(portfolio: any, prices: PricesMap): {
        allowed: boolean,
        reason?: string,
        alerts: RiskAlert[]
    } {
        const alerts: RiskAlert[] = []

        // Check circuit breakers
        const hasActiveCircuitBreaker = Array.from(this.circuitBreakers.values())
            .some(cb => cb.isTriggered && (cb.cooldownUntil || 0) > Date.now())

        if (hasActiveCircuitBreaker) {
            return {
                allowed: false,
                reason: 'Circuit breaker active due to high market volatility',
                alerts: [{
                    type: 'circuit_breaker',
                    severity: 'critical',
                    message: 'Rebalancing temporarily suspended due to circuit breaker',
                    recommendedAction: 'Wait for market conditions to stabilize',
                    timestamp: Date.now()
                }]
            }
        }

        // Check for extreme concentration after rebalance
        const riskMetrics = this.analyzePortfolioRisk(portfolio.allocations, prices)

        if (riskMetrics.concentrationRisk > 0.8) {
            alerts.push({
                type: 'concentration',
                severity: 'warning',
                message: 'High concentration risk detected',
                recommendedAction: 'Consider reducing allocation to dominant assets',
                timestamp: Date.now()
            })
        }

        if (riskMetrics.overallRiskLevel === 'critical') {
            return {
                allowed: false,
                reason: 'Portfolio risk level is critical',
                alerts: [...alerts, {
                    type: 'volatility',
                    severity: 'critical',
                    message: 'Portfolio risk exceeds safe limits',
                    recommendedAction: 'Review allocation strategy and reduce risk exposure',
                    timestamp: Date.now()
                }]
            }
        }

        return { allowed: true, alerts }
    }

    /**
     * Get current circuit breaker status
     */
    getCircuitBreakerStatus(): Record<string, CircuitBreakerStatus> {
        const status: Record<string, CircuitBreakerStatus> = {}

        this.circuitBreakers.forEach((value, key) => {
            // Clear expired circuit breakers
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

    private checkVolatility(asset: string, history: Array<{ price: number, timestamp: number }>): RiskAlert | null {
        if (history.length < 10) return null

        // Calculate volatility over last 10 periods
        const recentPrices = history.slice(-10).map(h => h.price)
        const returns = []

        for (let i = 1; i < recentPrices.length; i++) {
            returns.push((recentPrices[i] - recentPrices[i - 1]) / recentPrices[i - 1])
        }

        const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
        const volatility = Math.sqrt(variance)

        if (volatility > this.VOLATILITY_THRESHOLD) {
            return {
                type: 'volatility',
                severity: volatility > this.VOLATILITY_THRESHOLD * 1.5 ? 'critical' : 'warning',
                message: `High volatility detected in ${asset} (${(volatility * 100).toFixed(1)}%)`,
                asset,
                recommendedAction: 'Consider reducing exposure or implementing stop-loss measures',
                timestamp: Date.now()
            }
        }

        return null
    }

    private checkCircuitBreaker(asset: string, history: Array<{ price: number, timestamp: number }>): RiskAlert | null {
        if (history.length < 2) return null

        const currentPrice = history[history.length - 1].price
        const previousPrice = history[history.length - 2].price
        const priceChange = Math.abs(currentPrice - previousPrice) / previousPrice

        if (priceChange > this.CIRCUIT_BREAKER_THRESHOLD) {
            // Trigger circuit breaker
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

        return null
    }

    private calculateConcentrationRisk(allocations: Record<string, number>, totalValue: number): number {
        const maxAllocation = Math.max(...Object.values(allocations)) / totalValue
        return Math.min(maxAllocation / this.CONCENTRATION_LIMIT, 1.0)
    }

    private calculateVolatilityRisk(assets: string[]): number {
        let totalVolatility = 0
        let assetCount = 0

        assets.forEach(asset => {
            const history = this.priceHistory.get(asset)
            if (history && history.length > 5) {
                const recentPrices = history.slice(-5).map(h => h.price)
                const returns = []

                for (let i = 1; i < recentPrices.length; i++) {
                    returns.push(Math.abs((recentPrices[i] - recentPrices[i - 1]) / recentPrices[i - 1]))
                }

                const avgVolatility = returns.reduce((sum, r) => sum + r, 0) / returns.length
                totalVolatility += avgVolatility
                assetCount++
            }
        })

        return assetCount > 0 ? Math.min(totalVolatility / assetCount / this.VOLATILITY_THRESHOLD, 1.0) : 0
    }

    private calculateLiquidityRisk(allocations: Record<string, number>): number {
        // Simplified liquidity scoring based on asset types
        const liquidityScores: Record<string, number> = {
            'USDC': 0.95, // Stablecoin - high liquidity
            'BTC': 0.90,  // Major crypto - high liquidity
            'ETH': 0.85,  // Major crypto - high liquidity
            'XLM': 0.70   // Stellar native - medium liquidity
        }

        let weightedLiquidity = 0
        let totalWeight = 0

        Object.entries(allocations).forEach(([asset, allocation]) => {
            const liquidityScore = liquidityScores[asset] || 0.5 // Default medium liquidity
            weightedLiquidity += liquidityScore * allocation
            totalWeight += allocation
        })

        const avgLiquidity = totalWeight > 0 ? weightedLiquidity / totalWeight : 0.5
        return 1 - avgLiquidity // Higher risk = lower liquidity
    }

    private calculateCorrelationRisk(assets: string[]): number {
        // Simplified correlation risk based on asset diversity
        const assetTypes = new Set()

        assets.forEach(asset => {
            if (asset === 'USDC') assetTypes.add('stablecoin')
            else if (['BTC', 'ETH'].includes(asset)) assetTypes.add('major_crypto')
            else if (asset === 'XLM') assetTypes.add('stellar_native')
            else assetTypes.add('other')
        })

        // More asset types = lower correlation risk
        const diversityScore = assetTypes.size / 4 // Max 4 types
        return 1 - diversityScore
    }

    private determineOverallRisk(riskScores: number[]): 'low' | 'medium' | 'high' | 'critical' {
        const avgRisk = riskScores.reduce((sum, score) => sum + score, 0) / riskScores.length
        const maxRisk = Math.max(...riskScores)

        if (maxRisk > 0.9 || avgRisk > 0.8) return 'critical'
        if (maxRisk > 0.7 || avgRisk > 0.6) return 'high'
        if (maxRisk > 0.4 || avgRisk > 0.3) return 'medium'
        return 'low'
    }

    /**
     * Get risk management recommendations
     */
    getRecommendations(riskMetrics: RiskMetrics, allocations: Record<string, number>): string[] {
        const recommendations: string[] = []

        if (riskMetrics.concentrationRisk > 0.6) {
            const maxAsset = Object.entries(allocations)
                .reduce((max, [asset, allocation]) => allocation > max.allocation ? { asset, allocation } : max,
                    { asset: '', allocation: 0 })
            recommendations.push(`Consider reducing ${maxAsset.asset} allocation to improve diversification`)
        }

        if (riskMetrics.volatility > 0.6) {
            recommendations.push('High volatility detected - consider adding stable assets like USDC')
        }

        if (riskMetrics.liquidityRisk > 0.7) {
            recommendations.push('Improve liquidity by increasing allocation to major cryptocurrencies')
        }

        if (riskMetrics.correlationRisk > 0.8) {
            recommendations.push('Assets are highly correlated - diversify across different asset classes')
        }

        if (recommendations.length === 0) {
            recommendations.push('Portfolio risk levels are within acceptable ranges')
        }

        return recommendations
    }
}