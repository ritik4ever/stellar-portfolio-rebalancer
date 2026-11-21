import { checkVolatilityThreshold, getVolatilityThresholdPct } from '../config/volatilityConfig.js'
import {
    evaluateCooldown,
    MAX_PRICE_AGE_MS,
    type GuardrailContextValue,
    type GuardrailOutcomeKind,
    type GuardrailReasonCode,
} from './guardrailOutcomes.js'

/**
 * Result of a guardrail check. `safe`/`reason` are the original contract;
 * `outcome`, `reasonCode` and `context` are additive operator signals
 * (see guardrailOutcomes.ts) that distinguish delayed from blocked work.
 */
export interface GuardrailCheckResult {
    safe: boolean
    reason?: string
    outcome?: GuardrailOutcomeKind
    reasonCode?: GuardrailReasonCode
    context?: Record<string, GuardrailContextValue>
}

export class CircuitBreakers {
    static checkMarketConditions(prices: Record<string, any>): GuardrailCheckResult {
        // Check for extreme volatility
        const volatilityCheck = this.checkVolatility(prices)
        if (!volatilityCheck.safe) {
            return { ...volatilityCheck, outcome: 'delayed', reasonCode: 'HIGH_VOLATILITY' }
        }

        // Check for stale price data
        const freshnessCheck = this.checkDataFreshness(prices)
        if (!freshnessCheck.safe) return freshnessCheck

        // Check for correlation breakdown (all assets moving in same direction)
        const correlationCheck = this.checkCorrelation(prices)
        if (!correlationCheck.safe) return correlationCheck

        return { safe: true, outcome: 'allowed', reasonCode: 'MARKET_OK' }
    }

    private static checkVolatility(prices: Record<string, any>): { safe: boolean, reason?: string } {
        // Threshold is configurable (env / admin config store), defaults to 15%
        const volatilityThreshold = getVolatilityThresholdPct()
        return checkVolatilityThreshold(prices, volatilityThreshold)
    }

    private static checkDataFreshness(prices: Record<string, any>): GuardrailCheckResult {
        const maxAge = MAX_PRICE_AGE_MS / 1000 // 10 minutes in seconds
        const now = Date.now() / 1000

        for (const [asset, data] of Object.entries(prices)) {
            if (data.timestamp && (now - data.timestamp) > maxAge) {
                const ageSeconds = Math.floor(now - data.timestamp)
                return {
                    safe: false,
                    reason: `Stale price data for ${asset}: ${Math.floor((now - data.timestamp) / 60)} minutes old`,
                    outcome: 'delayed',
                    reasonCode: 'STALE_PRICE_DATA',
                    context: {
                        asset,
                        priceTimestamp: new Date(data.timestamp * 1000).toISOString(),
                        ageSeconds,
                        maxAgeSeconds: maxAge,
                        priceSource: typeof data.source === 'string' ? data.source : undefined,
                    },
                }
            }
        }

        return { safe: true }
    }

    private static checkCorrelation(prices: Record<string, any>): GuardrailCheckResult {
        const changes = Object.values(prices).map((data: any) => data.change || 0)

        // Check if all major assets are moving in the same direction (>5%)
        const significantMoves = changes.filter(change => Math.abs(change) > 5)

        if (significantMoves.length >= 3) {
            const allPositive = significantMoves.every(change => change > 0)
            const allNegative = significantMoves.every(change => change < 0)

            if (allPositive || allNegative) {
                return {
                    safe: false,
                    reason: `Extreme market correlation detected: all assets moving ${allPositive ? 'up' : 'down'} together`,
                    outcome: 'delayed',
                    reasonCode: 'CORRELATION_BREAKDOWN',
                    context: { direction: allPositive ? 'up' : 'down', significantMoves: significantMoves.length },
                }
            }
        }

        return { safe: true }
    }

    /**
     * Cooldown check. The window is half-open `[lastRebalance, lastRebalance + cooldown)`:
     * a request evaluated exactly at the expiry instant is permitted. See
     * `evaluateCooldown` in guardrailOutcomes.ts for the full boundary contract.
     */
    static checkCooldownPeriod(
        lastRebalance: string,
        minCooldownHours: number = 1,
        nowMs: number = Date.now(),
    ): GuardrailCheckResult & { cooldownEndsAt?: string; remainingMs?: number } {
        const decision = evaluateCooldown({
            source: 'circuit_breakers',
            lastRebalance,
            minCooldownHours,
            nowMs,
        })

        if (decision.outcome !== 'allowed') {
            return {
                safe: false,
                reason: decision.reason,
                outcome: decision.outcome,
                reasonCode: decision.reasonCode,
                context: decision.context,
                cooldownEndsAt: decision.cooldownEndsAt,
                remainingMs: decision.remainingMs,
            }
        }

        return {
            safe: true,
            outcome: 'allowed',
            reasonCode: decision.reasonCode,
            context: decision.context,
            cooldownEndsAt: decision.cooldownEndsAt,
            remainingMs: 0,
        }
    }

    static checkConcentrationRisk(allocations: Record<string, number>): GuardrailCheckResult {
        const maxSingleAsset = 80 // 80% maximum for any single asset
        const minDiversification = 1 // Minimum number of assets

        // Check maximum concentration (values are target percentages, 0-100)
        for (const [asset, percentage] of Object.entries(allocations)) {
            if (percentage > maxSingleAsset) {
                return {
                    safe: false,
                    reason: `Concentration risk: ${asset} represents ${percentage.toFixed(1)}% of portfolio`,
                    outcome: 'blocked',
                    reasonCode: 'CONCENTRATION_OVER_CAP',
                    context: { asset, weightPct: percentage, capPct: maxSingleAsset },
                }
            }
        }

        // Check minimum diversification
        const activeAssets = Object.values(allocations).filter(pct => pct > 1).length
        if (activeAssets < minDiversification) {
            return {
                safe: false,
                reason: `Insufficient diversification: only ${activeAssets} assets with meaningful allocation`,
                outcome: 'blocked',
                reasonCode: 'INSUFFICIENT_DIVERSIFICATION',
                context: { activeAssets, minDiversification },
            }
        }

        return { safe: true, outcome: 'allowed', reasonCode: 'CONCENTRATION_WITHIN_CAP' }
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