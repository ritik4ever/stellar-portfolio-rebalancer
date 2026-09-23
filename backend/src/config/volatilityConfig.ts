import { databaseService } from '../services/databaseService.js'

export const VOLATILITY_THRESHOLD_KV_KEY = 'circuit_breaker.volatility_threshold_pct'
export const DEFAULT_VOLATILITY_THRESHOLD_PCT = 15
export const MIN_VOLATILITY_THRESHOLD_PCT = 1
export const MAX_VOLATILITY_THRESHOLD_PCT = 50

export interface VolatilityThresholdCheckResult {
    safe: boolean
    reason?: string
}

export const isVolatilityThresholdPctValid = (pct: number): boolean =>
    Number.isFinite(pct) &&
    pct >= MIN_VOLATILITY_THRESHOLD_PCT &&
    pct <= MAX_VOLATILITY_THRESHOLD_PCT

const clampPct = (pct: number): number =>
    Math.min(MAX_VOLATILITY_THRESHOLD_PCT, Math.max(MIN_VOLATILITY_THRESHOLD_PCT, pct))

/**
 * Resolve the active volatility threshold in percent (1-50).
 * Precedence: environment override, persisted admin value, default.
 */
export function getVolatilityThresholdPct(env: NodeJS.ProcessEnv = process.env): number {
    const rawEnv = env.CIRCUIT_BREAKER_VOLATILITY_THRESHOLD_PCT
    if (rawEnv && rawEnv.trim() !== '') {
        const parsed = Number(rawEnv)
        if (Number.isFinite(parsed)) return clampPct(parsed)
    }

    const stored = databaseService.getKvValue(VOLATILITY_THRESHOLD_KV_KEY)
    if (stored && stored.trim() !== '') {
        const parsed = Number(stored)
        if (Number.isFinite(parsed)) return clampPct(parsed)
    }

    return DEFAULT_VOLATILITY_THRESHOLD_PCT
}

/** The volatility threshold expressed as a fraction (e.g. 15 -> 0.15). */
export function getVolatilityThresholdFraction(env: NodeJS.ProcessEnv = process.env): number {
    return getVolatilityThresholdPct(env) / 100
}

export function setVolatilityThresholdPct(pct: number): number {
    if (!isVolatilityThresholdPctValid(pct)) {
        throw new RangeError(
            `Volatility threshold must be between ${MIN_VOLATILITY_THRESHOLD_PCT}% and ${MAX_VOLATILITY_THRESHOLD_PCT}%`
        )
    }
    databaseService.setKvValue(VOLATILITY_THRESHOLD_KV_KEY, String(pct))
    return pct
}

/**
 * Shared volatility breach check used by the circuit breaker and the risk
 * management service. `prices` maps an asset key to its 24h `change` percent.
 */
export function checkVolatilityThreshold(
    prices: Record<string, any>,
    thresholdPct: number
): VolatilityThresholdCheckResult {
    for (const [asset, data] of Object.entries(prices)) {
        if (Math.abs(data.change) > thresholdPct) {
            return {
                safe: false,
                reason: `High volatility detected: ${asset} moved ${data.change.toFixed(2)}% in 24h`
            }
        }
    }

    return { safe: true }
}