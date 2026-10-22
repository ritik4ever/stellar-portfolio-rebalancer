/**
 * Analytics snapshot compaction retention settings, loaded from environment
 * variables and validated with documented fallbacks.
 *
 * - ANALYTICS_COMPACTION_CUTOFF_DAYS (default: 90): Number of days of analytics snapshots
 *   to retain before permanently pruning. Snapshots older than this are deleted.
 * - ANALYTICS_COMPACTION_RECENT_DAYS (default: 7): Number of recent days of raw,
 *   high-frequency snapshots to retain at full fidelity before rolling older data up
 *   into daily aggregates.
 */

export interface AnalyticsCompactionConfig {
    /** Number of days of analytics snapshots to retain before pruning. */
    cutoffDays: number
    /** Number of days of raw high-frequency snapshots to retain before daily rollup. */
    recentDays: number
}

export const DEFAULT_ANALYTICS_COMPACTION_CUTOFF_DAYS = 90
export const MIN_ANALYTICS_COMPACTION_CUTOFF_DAYS = 1
export const MAX_ANALYTICS_COMPACTION_CUTOFF_DAYS = 3650

export const DEFAULT_ANALYTICS_COMPACTION_RECENT_DAYS = 7
export const MIN_ANALYTICS_COMPACTION_RECENT_DAYS = 1
export const MAX_ANALYTICS_COMPACTION_RECENT_DAYS = 365

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
    const trimmed = value.trim()
    const num = Number(trimmed)
    if (!Number.isInteger(num) || num < min || num > max) {
        errors.push(
            `${fieldName} '${value}' is invalid. Provide an integer between ${min} and ${max}.`,
        )
        return fallback
    }
    return num
}

export function parseAnalyticsCompactionConfig(
    env: NodeJS.ProcessEnv = process.env,
): { config: AnalyticsCompactionConfig; errors: string[] } {
    const errors: string[] = []

    const rawCutoff =
        env.ANALYTICS_COMPACTION_CUTOFF_DAYS ??
        env.ANALYTICS_RETENTION_DAYS ??
        env.ANALYTICS_SNAPSHOT_RETENTION_DAYS
    const rawRecent =
        env.ANALYTICS_COMPACTION_RECENT_DAYS ??
        env.ANALYTICS_RAW_RETENTION_DAYS ??
        env.ANALYTICS_SNAPSHOT_RAW_DAYS

    let cutoffDays = parsePositiveInt(
        rawCutoff,
        DEFAULT_ANALYTICS_COMPACTION_CUTOFF_DAYS,
        'ANALYTICS_COMPACTION_CUTOFF_DAYS',
        errors,
        MIN_ANALYTICS_COMPACTION_CUTOFF_DAYS,
        MAX_ANALYTICS_COMPACTION_CUTOFF_DAYS,
    )

    let recentDays = parsePositiveInt(
        rawRecent,
        DEFAULT_ANALYTICS_COMPACTION_RECENT_DAYS,
        'ANALYTICS_COMPACTION_RECENT_DAYS',
        errors,
        MIN_ANALYTICS_COMPACTION_RECENT_DAYS,
        MAX_ANALYTICS_COMPACTION_RECENT_DAYS,
    )

    if (cutoffDays < recentDays) {
        errors.push(
            `ANALYTICS_COMPACTION_CUTOFF_DAYS (${cutoffDays}) must be greater than or equal to ANALYTICS_COMPACTION_RECENT_DAYS (${recentDays}).`,
        )
        // Reset to safe defaults on cross-field inconsistency
        cutoffDays = DEFAULT_ANALYTICS_COMPACTION_CUTOFF_DAYS
        recentDays = DEFAULT_ANALYTICS_COMPACTION_RECENT_DAYS
    }

    return {
        config: {
            cutoffDays,
            recentDays,
        },
        errors,
    }
}

export function getAnalyticsCompactionConfig(
    env: NodeJS.ProcessEnv = process.env,
): AnalyticsCompactionConfig {
    return parseAnalyticsCompactionConfig(env).config
}
