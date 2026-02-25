export class CircuitBreakers {
    static async checkMarketConditions(prices: Record<string, any>): Promise<{ safe: boolean, reason?: string }> {
        // Check for extreme volatility
        const volatilityCheck = this.checkVolatility(prices)
        if (!volatilityCheck.safe) return volatilityCheck

        // Check for stale price data
        const freshnessCheck = this.checkDataFreshness(prices)
        if (!freshnessCheck.safe) return freshnessCheck

        // Check for correlation breakdown (all assets moving in same direction)
        const correlationCheck = this.checkCorrelation(prices)
        if (!correlationCheck.safe) return correlationCheck

        return { safe: true }
    }

    private static checkVolatility(prices: Record<string, any>): { safe: boolean, reason?: string } {
        const volatilityThreshold = 15 // 15% change triggers circuit breaker

        for (const [asset, data] of Object.entries(prices)) {
            if (Math.abs(data.change) > volatilityThreshold) {
                return {
                    safe: false,
                    reason: `High volatility detected: ${asset} moved ${data.change.toFixed(2)}% in 24h`
                }
            }
        }

        return { safe: true }
    }

    private static checkDataFreshness(prices: Record<string, any>): { safe: boolean, reason?: string } {
        const maxAge = 10 * 60 // 10 minutes in seconds
        const now = Date.now() / 1000

        for (const [asset, data] of Object.entries(prices)) {
            if (data.timestamp && (now - data.timestamp) > maxAge) {
                return {
                    safe: false,
                    reason: `Stale price data for ${asset}: ${Math.floor((now - data.timestamp) / 60)} minutes old`
                }
            }
        }

        return { safe: true }
    }

    private static checkCorrelation(prices: Record<string, any>): { safe: boolean, reason?: string } {
        const changes = Object.values(prices).map((data: any) => data.change || 0)

        // Check if all major assets are moving in the same direction (>5%)
        const significantMoves = changes.filter(change => Math.abs(change) > 5)

        if (significantMoves.length >= 3) {
            const allPositive = significantMoves.every(change => change > 0)
            const allNegative = significantMoves.every(change => change < 0)

            if (allPositive || allNegative) {
                return {
                    safe: false,
                    reason: `Extreme market correlation detected: all assets moving ${allPositive ? 'up' : 'down'} together`
                }
            }
        }

        return { safe: true }
    }

    static checkCooldownPeriod(lastRebalance: string, minCooldownHours: number = 1): { safe: boolean, reason?: string } {
        const lastRebalanceTime = new Date(lastRebalance).getTime()
        const now = Date.now()
        const hoursSinceLastRebalance = (now - lastRebalanceTime) / (1000 * 60 * 60)

        if (hoursSinceLastRebalance < minCooldownHours) {
            return {
                safe: false,
                reason: `Cooldown active: ${(minCooldownHours - hoursSinceLastRebalance).toFixed(1)} hours remaining`
            }
        }

        return { safe: true }
    }

    static checkConcentrationRisk(allocations: Record<string, number>): { safe: boolean, reason?: string } {
        const maxSingleAsset = 80 // 80% maximum for any single asset
        const minDiversification = 1 // Minimum number of assets

        // Check maximum concentration (values are target percentages, 0-100)
        for (const [asset, percentage] of Object.entries(allocations)) {
            if (percentage > maxSingleAsset) {
                return {
                    safe: false,
                    reason: `Concentration risk: ${asset} represents ${percentage.toFixed(1)}% of portfolio`
                }
            }
        }

        // Check minimum diversification
        const activeAssets = Object.values(allocations).filter(pct => pct > 1).length
        if (activeAssets < minDiversification) {
            return {
                safe: false,
                reason: `Insufficient diversification: only ${activeAssets} assets with meaningful allocation`
            }
        }

        return { safe: true }
    }

    static checkTradeSize(tradeAmount: number, portfolioValue: number): { safe: boolean, reason?: string } {
        const maxTradePercentage = 25 // Maximum 25% of portfolio in single trade
        const tradePercentage = (tradeAmount / portfolioValue) * 100

        if (tradePercentage > maxTradePercentage) {
            return {
                safe: false,
                reason: `Trade size too large: ${tradePercentage.toFixed(1)}% of portfolio exceeds ${maxTradePercentage}% limit`
            }
        }

        if (tradeAmount < 10) {
            return {
                safe: false,
                reason: `Trade size too small: $${tradeAmount.toFixed(2)} below minimum $10 threshold`
            }
        }

        return { safe: true }
    }
}