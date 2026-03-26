/**
 * decimal.ts — Decimal-safe arithmetic utility for portfolio calculations.
 *
 * JS uses IEEE 754 double-precision floats, which causes well-known precision
 * issues (e.g. 0.1 + 0.2 !== 0.3). For financial calculations — percentages,
 * allocation drift, trade amounts, fees — this is unacceptable.
 *
 * This module provides a thin, dependency-free fixed-point helper that performs
 * all arithmetic at a configurable integer scale and rounds consistently.
 *
 * Precision strategy (matching Stellar's native precision):
 *   - Portfolio values, percentages, drift: 8 decimal places
 *   - XLM / Stellar amounts:               7 decimal places (1 stroop = 0.0000001 XLM)
 *   - Basis points:                         4 decimal places
 *
 * Usage:
 *   import { Dec } from '../utils/decimal.js'
 *
 *   Dec.add(0.1, 0.2)                  // → 0.3
 *   Dec.allocationsSum(allocations)    // → sum of allocation percentages
 *   Dec.allocationsSumValid(allocations) // → true if sum is within ε of 100
 *   Dec.drift(current, target)         // → absolute drift in percentage points
 *   Dec.percentage(part, total)        // → (part / total) * 100 with 8 dp
 *   Dec.targetValue(total, pct)        // → (total * pct) / 100 with 8 dp
 *   Dec.roundStellar(n)                // → amount rounded to 7 dp (1 stroop)
 *   Dec.roundPct(n)                    // → percentage rounded to 8 dp
 *   Dec.roundBps(n)                    // → bps rounded to 4 dp
 *   Dec.formatStellar(n)               // → string with 7 dp (for gasUsed, price)
 *   Dec.formatPct(n, dp?)              // → percentage string, default 2 dp
 *   Dec.formatBps(n, dp?)              // → basis-point string, default 2 dp
 */

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

/** One stroop — the minimum Stellar ledger unit */
const STROOP = 10_000_000 // 1 × 10^7

/** Percentage scale — 8 decimal places */
const PCT_SCALE = 100_000_000 // 1 × 10^8

/** Basis-point scale — 4 decimal places */
const BPS_SCALE = 10_000 // 1 × 10^4

/** Maximum absolute difference from 100 for a valid allocation sum */
const ALLOC_EPSILON = 0.01

// ─────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────

/**
 * Round a raw JS float to `dp` decimal places using "round half away from zero"
 * (banker's rounding causes systematic bias in financial contexts).
 */
function roundHalfUp(value: number, dp: number): number {
    const factor = Math.pow(10, dp)
    return Math.round(value * factor) / factor
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

export const Dec = {
    // ── Basic arithmetic ─────────────────────

    /** Add two numbers with 8 dp precision to avoid float accumulation errors */
    add(a: number, b: number): number {
        return roundHalfUp(a + b, 8)
    },

    /** Subtract b from a with 8 dp precision */
    sub(a: number, b: number): number {
        return roundHalfUp(a - b, 8)
    },

    /** Multiply two numbers with 8 dp precision */
    mul(a: number, b: number): number {
        return roundHalfUp(a * b, 8)
    },

    /** Divide a by b with 8 dp precision. Returns 0 if b is 0. */
    div(a: number, b: number): number {
        if (b === 0) return 0
        return roundHalfUp(a / b, 8)
    },

    // ── Rounding ─────────────────────────────

    /**
     * Round to 7 decimal places (Stellar stroop precision).
     * Use for all asset amounts and XLM fee values.
     */
    roundStellar(amount: number): number {
        return roundHalfUp(amount, 7)
    },

    /**
     * Round to 8 decimal places.
     * Use for portfolio percentages and allocation values.
     */
    roundPct(value: number): number {
        return roundHalfUp(value, 8)
    },

    /**
     * Round to 4 decimal places.
     * Use for basis-point values.
     */
    roundBps(value: number): number {
        return roundHalfUp(value, 4)
    },

    // ── Allocation helpers ────────────────────

    /**
     * Sum all allocation percentages in a deterministic way.
     * Replaces: `Object.values(allocations).reduce((sum, val) => sum + val, 0)`
     */
    allocationsSum(allocations: Record<string, number>): number {
        const values = Object.values(allocations)
        // Integer accumulation: multiply each value by scale, sum as integers, then divide
        const sumScaled = values.reduce((acc, v) => acc + Math.round(v * PCT_SCALE), 0)
        return sumScaled / PCT_SCALE
    },

    /**
     * Returns true when the allocation percentages sum to 100% within epsilon.
     * Replaces: `Math.abs(total - 100) > 0.01`
     */
    allocationsSumValid(allocations: Record<string, number>): boolean {
        const sum = Dec.allocationsSum(allocations)
        return Math.abs(sum - 100) <= ALLOC_EPSILON
    },

    // ── Portfolio calculation helpers ─────────

    /**
     * Calculate what percentage `part` is of `total`.
     * Replaces: `(currentValue / totalValue) * 100`
     */
    percentage(part: number, total: number): number {
        if (total === 0) return 0
        return roundHalfUp((part / total) * 100, 8)
    },

    /**
     * Calculate absolute drift between current and target percentages.
     * Replaces: `Math.abs(currentPercentage - targetPercentage)`
     */
    drift(current: number, target: number): number {
        return roundHalfUp(Math.abs(current - target), 8)
    },

    /**
     * Calculate the target dollar value of an asset at `pct`% of total.
     * Replaces: `(totalValue * targetPct) / 100`
     */
    targetValue(total: number, pct: number): number {
        if (total === 0) return 0
        // Integer path: round(total × pct × PCT_SCALE / 100) / PCT_SCALE
        return roundHalfUp((total * pct) / 100, 8)
    },

    /**
     * Calculate asset quantity from a target USD value and asset price.
     * Replaces: `transferValue / fromPrice`
     */
    assetQtyFromValue(value: number, price: number): number {
        if (price === 0) return 0
        return Dec.roundStellar(value / price)
    },

    /**
     * Calculate price limit for a trade given reference price and max slippage.
     * Replaces: `market.referencePrice * (1 - (maxSlippageBps / 10000))`
     */
    priceLimit(referencePrice: number, maxSlippageBps: number): number {
        // Use integer BPS arithmetic to avoid float drift
        const slippageFactor = roundHalfUp(1 - maxSlippageBps / BPS_SCALE, 8)
        return Dec.roundStellar(referencePrice * slippageFactor)
    },

    /**
     * Add a fee (in raw XLM stroop units) to a running total XLM fee.
     * Replaces: `totalEstimatedFeeXLM += fee / 10000000`
     */
    addStroopFee(currentXlm: number, stroops: number): number {
        return roundHalfUp(currentXlm + stroops / STROOP, 7)
    },

    // ── Formatting (string output) ────────────

    /**
     * Format a Stellar amount to a 7-dp string.
     * Replaces: `.toFixed(7)`
     */
    formatStellar(amount: number): string {
        return Dec.roundStellar(amount).toFixed(7)
    },

    /**
     * Format a percentage value to a string with `dp` decimal places (default 2).
     * Replaces: `(value * 100).toFixed(2)` and `value.toFixed(1)`
     */
    formatPct(value: number, dp: number = 2): string {
        return roundHalfUp(value, dp).toFixed(dp)
    },

    /**
     * Format a basis-point value to a string with `dp` decimal places (default 2).
     * Replaces: `value.toFixed(2)` in BPS contexts
     */
    formatBps(value: number, dp: number = 2): string {
        return roundHalfUp(value, dp).toFixed(dp)
    },

    /**
     * Format a weight (already a ratio in [0,1]) multiplied by 100 to a percentage string.
     * Replaces: `(riskMetrics.someValue * 100).toFixed(2)`
     */
    formatRatio(ratio: number, dp: number = 2): string {
        return roundHalfUp(ratio * 100, dp).toFixed(dp)
    },
}
