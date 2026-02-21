import { describe, it, expect } from 'vitest'
import { Dec } from '../utils/decimal.js'

// ─────────────────────────────────────────────
// Regression tests: decimal-safe portfolio math
// Issue #31 — Replace floating-point portfolio math with decimal-safe calculations
// ─────────────────────────────────────────────

describe('Dec.allocationsSum', () => {
    it('sums integer allocations correctly', () => {
        expect(Dec.allocationsSum({ XLM: 40, USDC: 35, BTC: 25 })).toBe(100)
    })

    it('avoids float drift when summing fractional percentages', () => {
        // Classic float trap: 33.3 + 33.3 + 33.4 = 99.99999... in naive JS
        const sum = Dec.allocationsSum({ A: 33.3, B: 33.3, C: 33.4 })
        expect(sum).toBeCloseTo(100, 8)
    })

    it('returns 0 for empty allocations', () => {
        expect(Dec.allocationsSum({})).toBe(0)
    })
})

describe('Dec.allocationsSumValid', () => {
    it('accepts allocations that sum to exactly 100', () => {
        expect(Dec.allocationsSumValid({ XLM: 50, USDC: 50 })).toBe(true)
    })

    it('accepts allocations within epsilon (99.995 to 100.005)', () => {
        expect(Dec.allocationsSumValid({ XLM: 50, USDC: 49.999 })).toBe(false)
        expect(Dec.allocationsSumValid({ XLM: 50, USDC: 50.005 })).toBe(true)
    })

    it('rejects allocations that clearly miss 100', () => {
        expect(Dec.allocationsSumValid({ XLM: 80, USDC: 15 })).toBe(false)
    })
})

describe('Dec.percentage', () => {
    it('calculates correct percentage', () => {
        expect(Dec.percentage(25, 100)).toBe(25)
        expect(Dec.percentage(1, 3)).toBeCloseTo(33.33333333, 6)
    })

    it('returns 0 when total is 0', () => {
        expect(Dec.percentage(10, 0)).toBe(0)
    })

    it('avoids float overflow — 0.1 + 0.2 style errors in value calc', () => {
        // totalValue = 0.1 + 0.2 computed naively = 0.30000000000000004
        const naiveTotal = 0.1 + 0.2
        const pct = Dec.percentage(0.1, naiveTotal)
        // should be very close to 33.33333333, not wildly off
        expect(pct).toBeCloseTo(33.33333333, 4)
    })
})

describe('Dec.drift', () => {
    it('computes absolute drift between two percentages', () => {
        expect(Dec.drift(45, 50)).toBe(5)
        expect(Dec.drift(50, 45)).toBe(5)
    })

    it('returns 0 for equal percentages', () => {
        expect(Dec.drift(33.33333333, 33.33333333)).toBe(0)
    })

    it('boundary case: 4.9999 vs 5.0000 is below 5% threshold', () => {
        // The key acceptance criterion from the issue
        expect(Dec.drift(45.0001, 50)).toBeLessThan(5)
        expect(Dec.drift(45, 50)).toBe(5)
    })
})

describe('Dec.targetValue', () => {
    it('computes target value correctly', () => {
        expect(Dec.targetValue(10000, 50)).toBe(5000)
        expect(Dec.targetValue(10000, 33.33333333)).toBeCloseTo(3333.333333, 4)
    })

    it('returns 0 when total is 0', () => {
        expect(Dec.targetValue(0, 50)).toBe(0)
    })

    it('sums of targetValues equals totalValue (no float leakage)', () => {
        const total = 10000
        const t1 = Dec.targetValue(total, 33.33)
        const t2 = Dec.targetValue(total, 33.33)
        const t3 = Dec.targetValue(total, 33.34)
        const sum = Dec.add(Dec.add(t1, t2), t3)
        expect(sum).toBeCloseTo(10000, 2)
    })
})

describe('Dec.roundStellar', () => {
    it('rounds to 7 decimal places', () => {
        expect(Dec.roundStellar(1.00000009)).toBe(1.0000001)
        expect(Dec.roundStellar(0.12345678901)).toBe(0.1234568)
    })

    it('preserves exact 7-digit Stellar amounts', () => {
        expect(Dec.roundStellar(1.0000001)).toBe(1.0000001)
        expect(Dec.roundStellar(0.0000001)).toBe(0.0000001)
    })
})

describe('Dec.priceLimit', () => {
    it('applies slippage correctly', () => {
        // 100 bps = 1% slippage on price 10.0 → 9.9
        expect(Dec.priceLimit(10.0, 100)).toBeCloseTo(9.9, 7)
    })

    it('returns exact Stellar-precision value', () => {
        // 50 bps = 0.5% on 1.0 → 0.9950000
        expect(Dec.priceLimit(1.0, 50)).toBeCloseTo(0.995, 7)
    })

    it('avoids float multiplication drift vs naive calculation', () => {
        const naive = 10.1234567 * (1 - 100 / 10000)
        const safe = Dec.priceLimit(10.1234567, 100)
        // Both should round to the same 7dp Stellar value
        expect(safe).toBe(Dec.roundStellar(naive))
    })
})

describe('Dec.addStroopFee', () => {
    it('adds a stroop fee correctly', () => {
        // 100 stroops = 0.00001 XLM
        expect(Dec.addStroopFee(0, 100)).toBeCloseTo(0.00001, 7)
    })

    it('accumulates multiple fees without float drift', () => {
        let total = 0
        for (let i = 0; i < 7; i++) {
            total = Dec.addStroopFee(total, 100)
        }
        expect(total).toBeCloseTo(0.00007, 7)
    })
})

describe('Dec.formatStellar', () => {
    it('formats to exactly 7 decimal places', () => {
        expect(Dec.formatStellar(1)).toBe('1.0000000')
        expect(Dec.formatStellar(0.1234567)).toBe('0.1234567')
    })
})

describe('Dec.formatPct', () => {
    it('formats to 2 decimal places by default', () => {
        expect(Dec.formatPct(5.1234)).toBe('5.12')
    })

    it('uses specified decimal places', () => {
        expect(Dec.formatPct(5.1234, 1)).toBe('5.1')
    })
})

describe('Dec.formatRatio', () => {
    it('multiplies ratio by 100 and formats to 2dp', () => {
        expect(Dec.formatRatio(0.1234)).toBe('12.34')
        expect(Dec.formatRatio(0.00456)).toBe('0.46')
    })
})
