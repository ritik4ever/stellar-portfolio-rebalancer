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
    return result.rows.map(r => ({
        portfolioId: r.portfolio_id,
        timestamp: r.timestamp.toISOString(),
        totalValue: Number(r.total_value),
        allocations: (r.allocations as Record<string, number>) ?? {},
        balances: (r.balances as Record<string, number>) ?? {}
    }))
}
