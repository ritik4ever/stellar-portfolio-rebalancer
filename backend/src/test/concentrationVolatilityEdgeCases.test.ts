import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CircuitBreakers } from '../services/circuitBreakers.js'
import {
    DEFAULT_MAX_PARTIAL_FILL_OBSERVATIONS,
    evaluatePartialFillConcentration,
} from '../services/guardrailOutcomes.js'

/**
 * Deterministic coverage for the concentration-cap boundary and the
 * volatility feed missing an interval. All guardrail evaluations are
 * pure/read-only, so repeated calls cannot duplicate side effects.
 */
describe('Concentration limit and volatility pause edge cases (SPR-2026-141/142/145/147)', () => {
    beforeEach(() => {
        vi.stubEnv('CIRCUIT_BREAKER_VOLATILITY_THRESHOLD_PCT', '15')
    })

    afterEach(() => {
        vi.unstubAllEnvs()
        vi.restoreAllMocks()
    })

    describe('concentration cap boundary', () => {
        it('allows a target weight exactly at the configured cap and documents the boundary', () => {
            const result = CircuitBreakers.checkConcentrationRisk({ BTC: 80, ETH: 20 })

            expect(result).toMatchObject({
                safe: true,
                outcome: 'allowed',
                reasonCode: 'CONCENTRATION_WITHIN_CAP',
            })
            expect(result.context).toMatchObject({
                asset: 'BTC',
                weightPct: 80,
                capPct: 80,
                postTradeWeightPct: 80,
                headroomPct: 0,
                atCap: true,
            })
        })

        it('blocks a target weight one tick above the cap with post-trade allocation', () => {
            const result = CircuitBreakers.checkConcentrationRisk({ BTC: 80.0001, ETH: 19.9999 })

            expect(result).toMatchObject({
                safe: false,
                outcome: 'blocked',
                reasonCode: 'CONCENTRATION_OVER_CAP',
            })
            expect(result.context).toMatchObject({
                asset: 'BTC',
                postTradeWeightPct: 80.0001,
                capPct: 80,
                headroomPct: 0,
                atCap: false,
            })
        })

        it('returns a stable result across repeated evaluations', () => {
            const allocations = { BTC: 80, ETH: 20 }
            const first = CircuitBreakers.checkConcentrationRisk(allocations)
            const second = CircuitBreakers.checkConcentrationRisk(allocations)
            expect(second).toEqual(first)
        })
    })

    describe('partial fill pushing remaining weight over the cap', () => {
        const partialInput = {
            source: 'rebalance_worker',
            portfolioId: 'p1',
            holdingsUsd: { XLM: 850, USDC: 150 },
            plannedLegs: 3,
            filledLegs: 1,
        }

        it('delays while legs are pending and reports post-trade allocation', () => {
            const result = evaluatePartialFillConcentration(partialInput)

            expect(result.outcome).toBe('delayed')
            expect(result.reasonCode).toBe('CONCENTRATION_PARTIAL_FILL_OVER_CAP')
            expect(result.context).toMatchObject({
                asset: 'XLM',
                weightPct: 85,
                capPct: 80,
                overByPct: 5,
                plannedLegs: 3,
                filledLegs: 1,
                pendingLegs: 2,
            })
        })

        it('explicitly stops after the bounded number of over-cap observations', () => {
            const below = evaluatePartialFillConcentration({
                ...partialInput,
                partialFillObservations: DEFAULT_MAX_PARTIAL_FILL_OBSERVATIONS - 1,
            })
            expect(below.outcome).toBe('delayed')
            expect(below.reasonCode).toBe('CONCENTRATION_PARTIAL_FILL_OVER_CAP')

            const stuck = evaluatePartialFillConcentration({
                ...partialInput,
                partialFillObservations: DEFAULT_MAX_PARTIAL_FILL_OBSERVATIONS,
            })
            expect(stuck.outcome).toBe('blocked')
            expect(stuck.reasonCode).toBe('CONCENTRATION_PARTIAL_FILL_STUCK')
            expect(stuck.context).toMatchObject({
                asset: 'XLM',
                weightPct: 85,
                partialFillObservations: DEFAULT_MAX_PARTIAL_FILL_OBSERVATIONS,
            })
        })

        it('blocks once every leg filled and the weight remains over the cap', () => {
            const result = evaluatePartialFillConcentration({
                ...partialInput,
                filledLegs: 3,
            })
            expect(result.outcome).toBe('blocked')
            expect(result.reasonCode).toBe('CONCENTRATION_OVER_CAP')
        })

        it('never duplicates side effects: evaluations are pure and stable', () => {
            const first = evaluatePartialFillConcentration(partialInput)
            const second = evaluatePartialFillConcentration(partialInput)
            expect(second).toEqual(first)
        })
    })

    describe('volatility feed missing one interval', () => {
        const nowSec = Math.floor(Date.now() / 1000)

        it('delays with a diagnosable reason instead of silently passing', () => {
            const result = CircuitBreakers.checkMarketConditions({
                XLM: { change: Number.NaN, timestamp: nowSec },
                BTC: { change: 1.5, timestamp: nowSec },
            })

            expect(result.safe).toBe(false)
            expect(result.outcome).toBe('delayed')
            expect(result.reasonCode).toBe('VOLATILITY_DATA_INCOMPLETE')
            expect(result.context).toMatchObject({ asset: 'XLM', missingInterval: true })
            expect(result.reason).toContain('missing interval')
        })

        it('treats an absent change field the same way', () => {
            const result = CircuitBreakers.checkMarketConditions({
                XLM: { timestamp: nowSec },
                BTC: { change: -0.5, timestamp: nowSec },
            })
            expect(result.reasonCode).toBe('VOLATILITY_DATA_INCOMPLETE')
        })

        it('still allows a complete feed within tolerance', () => {
            const result = CircuitBreakers.checkMarketConditions({
                XLM: { change: 2.5, timestamp: nowSec },
                BTC: { change: -1.5, timestamp: nowSec },
            })
            expect(result).toMatchObject({ safe: true, outcome: 'allowed', reasonCode: 'MARKET_OK' })
        })
    })
})
