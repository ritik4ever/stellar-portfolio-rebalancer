/**
 * Rebalancing concurrency lock settings, loaded from the environment and
 * validated with documented fallbacks.
 *
 * Recommended range for REBALANCE_LOCK_TTL_MS:
 *   - Minimum reasonable value: 15_000 (15s) — must comfortably exceed the
 *     longest rebalance+consensus window, otherwise a still-running rebalance
 *     can be overtaken by another worker.
 *   - Default: 300_000 (5 min) — a safe general-purpose hold that covers
 *     simulated and on-chain rebalances without long stale-lock windows.
 *   - Maximum reasonable value: 1_800_000 (30 min) — beyond this, a crash
 *     leaves the portfolio locked for a very long time before TTL recovery.
 */

export interface RebalanceLockConfig {
    /** Time-to-live for rebalancing locks in milliseconds. */
    ttlMs: number
}

export const DEFAULT_REBALANCE_LOCK_TTL_MS = 5 * 60 * 1000
export const MIN_REBALANCE_LOCK_TTL_MS = 1_000
export const MAX_REBALANCE_LOCK_TTL_MS = 30 * 60 * 1000

function parsePositiveInt(
    value: string | undefined,
    fallback: number,
    fieldName: string,
    errors: string[],
    min: number,
    max: number,
): number {
    if (value === undefined || value.trim() === '') {
        return fallback
    }
    const parsed = Number.parseInt(value.trim(), 10)
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        errors.push(
            `${fieldName} '${value}' is invalid. Provide an integer between ${min} and ${max}.`,
        )
        return fallback
    }
    return parsed
}

export function parseRebalanceLockConfig(
    env: NodeJS.ProcessEnv = process.env,
): { config: RebalanceLockConfig; errors: string[] } {
    const errors: string[] = []

    const ttlMs = parsePositiveInt(
        env.REBALANCE_LOCK_TTL_MS,
        DEFAULT_REBALANCE_LOCK_TTL_MS,
        'REBALANCE_LOCK_TTL_MS',
        errors,
        MIN_REBALANCE_LOCK_TTL_MS,
        MAX_REBALANCE_LOCK_TTL_MS,
    )

    return {
        config: { ttlMs },
        errors,
    }
}

export function getRebalanceLockConfig(
    env: NodeJS.ProcessEnv = process.env,
): RebalanceLockConfig {
    return parseRebalanceLockConfig(env).config
}