import { query } from './client.js'

export interface AnalyticsSnapshotRow {
    id: number
    portfolio_id: string
    timestamp: Date
    total_value: number
    allocations: unknown
    balances: unknown
}

export async function dbInsertAnalyticsSnapshot(
    portfolioId: string,
    totalValue: number,
    allocations: Record<string, number>,
    balances: Record<string, number>
) {
    await query(
        `INSERT INTO analytics_snapshots (portfolio_id, total_value, allocations, balances) VALUES ($1, $2, $3, $4)`,
        [portfolioId, totalValue, JSON.stringify(allocations), JSON.stringify(balances)]
    )
}

export async function dbGetAnalyticsSnapshots(portfolioId: string, days: number) {
    const result = await query<AnalyticsSnapshotRow>(
        `SELECT * FROM analytics_snapshots WHERE portfolio_id = $1 AND timestamp > NOW() - INTERVAL '1 day' * $2 ORDER BY timestamp ASC`,
        [portfolioId, days]
    )
    return result.rows.map((r: AnalyticsSnapshotRow) => ({
        portfolioId: r.portfolio_id,
        timestamp: r.timestamp.toISOString(),
        totalValue: Number(r.total_value),
        allocations: (r.allocations as Record<string, number>) ?? {},
        balances: (r.balances as Record<string, number>) ?? {}
    }))
}

export interface CompactionStats {
    portfolioId: string
    deletedCount: number
    retainedCount: number
    compactionCutoffTimestamp: string
}

/**
 * Compacts old analytics snapshots by deleting granular data older than the retention cutoff
 * while keeping one snapshot per day for historical reference.
 * 
 * Strategy:
 * - Delete all snapshots older than cutoffDays
 * - For snapshots between cutoffDays and recentDays, keep only the last snapshot of each day
 * - Keep all snapshots from the last recentDays (high-frequency data)
 * 
 * @param portfolioId - Portfolio to compact
 * @param cutoffDays - Delete all snapshots older than this (default: 90)
 * @param recentDays - Keep high-frequency data for this period (default: 7)
 */
export async function dbCompactAnalyticsSnapshots(
    portfolioId: string,
    cutoffDays: number = 90,
    recentDays: number = 7
): Promise<CompactionStats> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - cutoffDays)
    const cutoffTimestamp = cutoffDate.toISOString()

    // Count snapshots before deletion
    const countBefore = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM analytics_snapshots WHERE portfolio_id = $1`,
        [portfolioId]
    )
    const countBeforeValue = parseInt(countBefore.rows[0]?.count ?? '0', 10)

    // Phase 1: Delete all snapshots older than cutoffDays
    await query(
        `DELETE FROM analytics_snapshots 
         WHERE portfolio_id = $1 
         AND timestamp < NOW() - INTERVAL '1 day' * $2`,
        [portfolioId, cutoffDays]
    )

    // Phase 2: For snapshots between cutoffDays and recentDays, keep only the last per day
    // Identify snapshots to keep (last of each day in the intermediate range)
    const snapshotsToKeep = await query<{ id: number }>(
        `SELECT DISTINCT ON (DATE(timestamp)) id
         FROM analytics_snapshots
         WHERE portfolio_id = $1
         AND timestamp >= NOW() - INTERVAL '1 day' * $2
         AND timestamp < NOW() - INTERVAL '1 day' * $3
         ORDER BY DATE(timestamp), timestamp DESC`,
        [portfolioId, cutoffDays, recentDays]
    )

    const keepIds = snapshotsToKeep.rows.map((r: { id: number }) => r.id)

    if (keepIds.length > 0) {
        // Delete all other snapshots in the intermediate range
        const placeholders = keepIds.map((_: number, i: number) => `$${i + 3}`).join(',')
        await query(
            `DELETE FROM analytics_snapshots
             WHERE portfolio_id = $1
             AND timestamp >= NOW() - INTERVAL '1 day' * $2
             AND timestamp < NOW() - INTERVAL '1 day' * $3
             AND id NOT IN (${placeholders})`,
            [portfolioId, cutoffDays, recentDays, ...keepIds]
        )
    }

    // Count snapshots after deletion
    const countAfter = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM analytics_snapshots WHERE portfolio_id = $1`,
        [portfolioId]
    )
    const countAfterValue = parseInt(countAfter.rows[0]?.count ?? '0', 10)

    return {
        portfolioId,
        deletedCount: Math.max(0, countBeforeValue - countAfterValue),
        retainedCount: countAfterValue,
        compactionCutoffTimestamp: cutoffTimestamp,
    }
}
