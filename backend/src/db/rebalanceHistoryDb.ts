import { query } from './client.js'

export interface RebalanceEventRow {
    id: string
    portfolio_id: string
    timestamp: Date
    trigger: string
    trades: number
    gas_used: string
    status: string
    is_automatic: boolean
    risk_alerts: unknown
    error: string | null
    details: unknown
}

function rowToEvent(r: RebalanceEventRow) {
    return {
        id: r.id,
        portfolioId: r.portfolio_id,
        timestamp: r.timestamp.toISOString(),
        trigger: r.trigger,
        trades: r.trades,
        gasUsed: r.gas_used,
        status: r.status as 'completed' | 'failed' | 'pending',
        isAutomatic: r.is_automatic,
        riskAlerts: (r.risk_alerts as any[]) ?? [],
        error: r.error ?? undefined,
        details: r.details ?? undefined
    }
}

export async function dbInsertRebalanceEvent(event: {
    id: string
    portfolioId: string
    trigger: string
    trades: number
    gasUsed: string
    status: string
    isAutomatic: boolean
    riskAlerts?: unknown[]
    error?: string
    details?: unknown
}) {
    await query(
        `INSERT INTO rebalance_events (id, portfolio_id, trigger, trades, gas_used, status, is_automatic, risk_alerts, error, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
            event.id,
            event.portfolioId,
            event.trigger,
            event.trades,
            event.gasUsed,
            event.status,
            event.isAutomatic,
            event.riskAlerts ? JSON.stringify(event.riskAlerts) : null,
            event.error ?? null,
            event.details ? JSON.stringify(event.details) : null
        ]
    )
}

export async function dbGetRebalanceHistoryByPortfolio(portfolioId: string, limit: number) {
    const result = await query<RebalanceEventRow>(
        `SELECT * FROM rebalance_events WHERE portfolio_id = $1 ORDER BY timestamp DESC LIMIT $2`,
        [portfolioId, limit]
    )
    return result.rows.map(rowToEvent)
}

export async function dbGetRebalanceHistoryAll(limit: number) {
    const result = await query<RebalanceEventRow>(
        `SELECT * FROM rebalance_events ORDER BY timestamp DESC LIMIT $1`,
        [limit]
    )
    return result.rows.map(rowToEvent)
}

export async function dbGetRecentAutoRebalances(portfolioId: string, limit: number) {
    const result = await query<RebalanceEventRow>(
        `SELECT * FROM rebalance_events WHERE portfolio_id = $1 AND is_automatic = true ORDER BY timestamp DESC LIMIT $2`,
        [portfolioId, limit]
    )
    return result.rows.map(rowToEvent)
}

export async function dbGetAutoRebalancesSince(portfolioId: string, since: Date) {
    const result = await query<RebalanceEventRow>(
        `SELECT * FROM rebalance_events WHERE portfolio_id = $1 AND is_automatic = true AND timestamp >= $2 ORDER BY timestamp DESC`,
        [portfolioId, since]
    )
    return result.rows.map(rowToEvent)
}

export async function dbGetAllAutoRebalances(limit: number = 1000) {
    const result = await query<RebalanceEventRow>(
        `SELECT * FROM rebalance_events WHERE is_automatic = true ORDER BY timestamp DESC LIMIT $1`,
        [limit]
    )
    return result.rows.map(rowToEvent)
}

export async function dbGetHistoryStats(): Promise<{
    totalEvents: number
    portfolios: number
    recentActivity: number
    autoRebalances: number
}> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const totalResult = await query<{ count: string }>('SELECT COUNT(*) as count FROM rebalance_events')
    const recentResult = await query<{ count: string }>(
        'SELECT COUNT(*) as count FROM rebalance_events WHERE timestamp > $1',
        [oneDayAgo]
    )
    const autoResult = await query<{ count: string }>(
        'SELECT COUNT(*) as count FROM rebalance_events WHERE is_automatic = true'
    )
    const portfoliosResult = await query<{ count: string }>(
        'SELECT COUNT(DISTINCT portfolio_id) as count FROM rebalance_events'
    )
    return {
        totalEvents: parseInt(totalResult.rows[0]?.count ?? '0', 10),
        portfolios: parseInt(portfoliosResult.rows[0]?.count ?? '0', 10),
        recentActivity: parseInt(recentResult.rows[0]?.count ?? '0', 10),
        autoRebalances: parseInt(autoResult.rows[0]?.count ?? '0', 10)
    }
}
