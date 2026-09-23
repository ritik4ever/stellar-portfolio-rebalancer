import { describe, it, expect, vi, afterEach } from 'vitest'
import {
    checkVolatilityThreshold,
    DEFAULT_VOLATILITY_THRESHOLD_PCT,
    getVolatilityThresholdFraction,
    getVolatilityThresholdPct,
    isVolatilityThresholdPctValid,
    setVolatilityThresholdPct,
    VOLATILITY_THRESHOLD_KV_KEY
} from '../config/volatilityConfig.js'
import { databaseService } from '../services/databaseService.js'

describe('volatilityConfig shared module (#1385/#1386)', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllEnvs()
        databaseService.deleteKvValue(VOLATILITY_THRESHOLD_KV_KEY)
    })

    it('defaults to 15% when nothing is configured', () => {
        expect(getVolatilityThresholdPct()).toBe(DEFAULT_VOLATILITY_THRESHOLD_PCT)
        expect(DEFAULT_VOLATILITY_THRESHOLD_PCT).toBe(15)
        expect(getVolatilityThresholdFraction()).toBeCloseTo(0.15)
    })

    it('prefers the environment override over the default', () => {
        vi.stubEnv('CIRCUIT_BREAKER_VOLATILITY_THRESHOLD_PCT', '30')
        expect(getVolatilityThresholdPct()).toBe(30)
        expect(getVolatilityThresholdFraction()).toBeCloseTo(0.3)
    })

    it('uses the persisted admin value when env is not set', () => {
        vi.spyOn(databaseService, 'getKvValue').mockReturnValue('20')
        expect(getVolatilityThresholdPct()).toBe(20)
        expect(getVolatilityThresholdFraction()).toBeCloseTo(0.2)
    })

    it('clamps out-of-range environment overrides into the valid range', () => {
        vi.stubEnv('CIRCUIT_BREAKER_VOLATILITY_THRESHOLD_PCT', '200')
        expect(getVolatilityThresholdPct()).toBe(50)

        vi.stubEnv('CIRCUIT_BREAKER_VOLATILITY_THRESHOLD_PCT', '-5')
        expect(getVolatilityThresholdPct()).toBe(1)
    })

    it('persists a validated threshold through setVolatilityThresholdPct', () => {
        const setKvSpy = vi.spyOn(databaseService, 'setKvValue')
        expect(setVolatilityThresholdPct(25)).toBe(25)
        expect(setKvSpy).toHaveBeenCalledWith(VOLATILITY_THRESHOLD_KV_KEY, '25')
    })

    it('rejects out-of-range thresholds in setVolatilityThresholdPct', () => {
        expect(() => setVolatilityThresholdPct(0.5)).toThrow(RangeError)
        expect(() => setVolatilityThresholdPct(51)).toThrow(RangeError)
        expect(() => setVolatilityThresholdPct(Number.NaN)).toThrow(RangeError)
    })

    it('validates candidate values against the configured bounds', () => {
        expect(isVolatilityThresholdPctValid(1)).toBe(true)
        expect(isVolatilityThresholdPctValid(50)).toBe(true)
        expect(isVolatilityThresholdPctValid(0.9)).toBe(false)
        expect(isVolatilityThresholdPctValid(50.1)).toBe(false)
        expect(isVolatilityThresholdPctValid(Number.NaN)).toBe(false)
    })

    it('flags a breach and builds the shared reason message', () => {
        const safe = checkVolatilityThreshold({ BTC: { change: 10 } }, 15)
        expect(safe).toEqual({ safe: true })

        const breach = checkVolatilityThreshold({ BTC: { change: 16.25 } }, 15)
        expect(breach.safe).toBe(false)
        expect(breach.reason).toBe('High volatility detected: BTC moved 16.25% in 24h')
    })
})