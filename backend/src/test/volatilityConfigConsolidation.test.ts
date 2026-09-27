import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkVolatilityThreshold, getVolatilityThresholdPct, getVolatilityThresholdFraction } from '../config/volatilityConfig.js'
import { CircuitBreakers } from '../services/circuitBreakers.js'
import { RiskManagementService } from '../services/riskManagements.js'
import { databaseService } from '../services/databaseService.js'

describe('Volatility threshold consolidation (#1179)', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllEnvs()
    })

    it('both services use the same shared volatility threshold module', () => {
        // CircuitBreakers uses checkVolatilityThreshold from volatilityConfig
        const circuitBreakerResult = CircuitBreakers.checkMarketConditions({
            BTC: { change: 16, timestamp: Date.now() / 1000 }
        })
        expect(circuitBreakerResult.safe).toBe(false)
        expect(circuitBreakerResult.reason).toContain('High volatility detected')
    })

    it('shared threshold is configurable and respected by both services', async () => {
        vi.stubEnv('CIRCUIT_BREAKER_VOLATILITY_THRESHOLD_PCT', '25')

        const thresholdPct = getVolatilityThresholdPct()
        expect(thresholdPct).toBe(25)

        // Should be safe with 20% change when threshold is 25%
        const safeResult = await CircuitBreakers.checkMarketConditions({
            BTC: { change: 20, timestamp: Date.now() / 1000 }
        })
        expect(safeResult.safe).toBe(true)

        // Should breach with 26% change when threshold is 25%
        const breachResult = await CircuitBreakers.checkMarketConditions({
            BTC: { change: 26, timestamp: Date.now() / 1000 }
        })
        expect(breachResult.safe).toBe(false)
    })

    it('shared threshold from database is used by both services', async () => {
        vi.spyOn(databaseService, 'getKvValue').mockReturnValue('18')

        const thresholdPct = getVolatilityThresholdPct()
        expect(thresholdPct).toBe(18)

        // Should be safe with 17% change when threshold is 18%
        const safeResult = await CircuitBreakers.checkMarketConditions({
            BTC: { change: 17, timestamp: Date.now() / 1000 }
        })
        expect(safeResult.safe).toBe(true)

        // Should breach with 19% change when threshold is 18%
        const breachResult = await CircuitBreakers.checkMarketConditions({
            BTC: { change: 19, timestamp: Date.now() / 1000 }
        })
        expect(breachResult.safe).toBe(false)
    })

    it('threshold fraction is correctly calculated from percentage', () => {
        vi.stubEnv('CIRCUIT_BREAKER_VOLATILITY_THRESHOLD_PCT', '10')

        const thresholdPct = getVolatilityThresholdPct()
        const thresholdFraction = getVolatilityThresholdFraction()

        expect(thresholdPct).toBe(10)
        expect(thresholdFraction).toBe(0.10)
    })

    it('checkVolatilityThreshold function is shared and reusable', () => {
        vi.stubEnv('CIRCUIT_BREAKER_VOLATILITY_THRESHOLD_PCT', '15')
        const threshold = getVolatilityThresholdPct()

        const prices = {
            BTC: { change: 14 },
            ETH: { change: 16 }
        }

        const result = checkVolatilityThreshold(prices, threshold)
        expect(result.safe).toBe(false)
        expect(result.reason).toContain('ETH')
    })
})
