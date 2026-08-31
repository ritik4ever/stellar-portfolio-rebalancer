import { query } from './client.js'

export interface RebalanceEventRow {
    id: string
    portfolio_id: string
    timestamp: Date
    trigger: string
    trades: number
    gas_used: string
    fee_paid: string
    slippage_bps: string
    status: string
    is_automatic: boolean
    risk_alerts: unknown
    error: string | null
    details: unknown
}

function rowToEvent(r: RebalanceEventRow) {
    const details = r.details as Record<string, unknown> | undefined
    return {
        id: r.id,
        portfolioId: r.portfolio_id,
        timestamp: r.timestamp.toISOString(),
        trigger: r.trigger,
        trades: r.trades,
        gasUsed: r.gas_used,
        feePaid: Number(r.fee_paid ?? 0),
        slippageBps: Number(r.slippage_bps ?? 0),
        status: r.status as 'completed' | 'failed' | 'pending',
        isAutomatic: r.is_automatic,
        riskAlerts: (r.risk_alerts as any[]) ?? [],
        error: r.error ?? undefined,
        actor: details?.actor as 'user' | 'system' | 'admin' | 'scheduler' | undefined,
        source: details?.source as 'dashboard' | 'api' | 'contract' | 'scheduler' | 'auto_rebalance' | undefined,
        triggerMetadata: details?.triggerMetadata as Record<string, unknown> | undefined,
        details: details ?? undefined
    }
}

export async function dbInsertRebalanceEvent(event: {
    id: string
    portfolioId: string
    trigger: string
    trades: number
    gasUsed: string
    feePaid?: number
    slippageBps?: number
    status: string
    isAutomatic: boolean
    riskAlerts?: unknown[]
    error?: string
    details?: unknown
    timestamp?: Date
}): Promise<{ id: string }> {
    await query(
        `INSERT INTO rebalance_events (id, portfolio_id, trigger, trades, gas_used, fee_paid, slippage_bps, status, is_automatic, risk_alerts, error, details, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, NOW()))`,
        [
            event.id,
            event.portfolioId,
            event.trigger,
            event.trades,
            event.gasUsed,
            event.feePaid ?? 0,
            event.slippageBps ?? 0,
            event.status,
            event.isAutomatic,
            event.riskAlerts ? JSON.stringify(event.riskAlerts) : null,
            event.error ?? null,
            event.details ? JSON.stringify(event.details) : null,
            event.timestamp ?? null
        ]
    )
    return { id: event.id }
}

export async function dbGetRebalanceHistoryByPortfolio(portfolioId: string, limit: number, offset = 0) {
    const result = await query<RebalanceEventRow>(
        `SELECT * FROM rebalance_events WHERE portfolio_id = $1 ORDER BY timestamp DESC LIMIT $2 OFFSET $3`,
        [portfolioId, limit, offset]
    )
    return result.rows.map(rowToEvent)
}

export async function dbGetRebalanceHistoryCountByPortfolio(portfolioId: string): Promise<number> {
    const result = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM rebalance_events WHERE portfolio_id = $1`,
        [portfolioId]
    )
    return parseInt(result.rows[0]?.count ?? '0', 10)
}

export interface RebalanceCostSummary {
    total_fees_paid: number
    avg_slippage_bps: number
    cost_per_rebalance: number
    total_rebalances: number
}

export async function dbGetRebalanceCostSummary(portfolioId: string): Promise<RebalanceCostSummary> {
    const result = await query<{
        total_fees_paid: string
        avg_slippage_bps: string
        total_rebalances: string
    }>(
        `SELECT
            COALESCE(SUM(fee_paid), 0) as total_fees_paid,
            COALESCE(AVG(slippage_bps), 0) as avg_slippage_bps,
            COUNT(*) as total_rebalances
         FROM rebalance_events
         WHERE portfolio_id = $1`,
        [portfolioId]
    )
    const row = result.rows[0]
    const totalFees = Number(row?.total_fees_paid ?? 0)
    const totalRebalances = parseInt(row?.total_rebalances ?? '0', 10)

    return {
        total_fees_paid: totalFees,
        avg_slippage_bps: Number(row?.avg_slippage_bps ?? 0),
        cost_per_rebalance: totalRebalances > 0 ? totalFees / totalRebalances : 0,
        total_rebalances: totalRebalances
    }
}

export async function dbGetRebalanceHistoryAll(limit: number, offset = 0) {
    const result = await query<RebalanceEventRow>(
        `SELECT * FROM rebalance_events ORDER BY timestamp DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
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

export interface RebalanceHistoryQueryOptions {
  isAutomatic?: boolean
  status?: 'completed' | 'failed' | 'pending'
  since?: string
  until?: string
  eventSource?: 'offchain' | 'simulated' | 'onchain'
  startTimestamp?: string
  endTimestamp?: string
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

/**
 * Filtered, paginated history for a single portfolio (issue #995).
 *
 * Maps the public-API filter vocabulary to the DB schema:
 *   trigger_type='manual'          → is_automatic = false AND trigger NOT ILIKE '%circuit%'
 *   trigger_type='auto'            → is_automatic = true
 *   trigger_type='circuit_breaker' → trigger ILIKE '%circuit%'
 *   status='success'               → status = 'completed'
 *   status='partial'               → status = 'pending'
 *   status='failed'                → status = 'failed'
 *
 * Response shape (per-item): timestamp, trigger, assets_traded, total_fee, total_slippage, status, error_reason
 */
export interface PortfolioRebalanceHistoryFilter {
    from?: string            // ISO-8601
    to?: string              // ISO-8601
    trigger_type?: 'manual' | 'auto' | 'circuit_breaker'
    status?: 'success' | 'partial' | 'failed'
    limit: number
    offset: number
    sort: 'asc' | 'desc'
}

export interface PortfolioRebalanceHistoryItem {
    id: string
    portfolioId: string
    timestamp: string
    trigger: string
    triggerType: 'manual' | 'auto' | 'circuit_breaker'
    assetsTrades: number
    totalFeeXlm: number | null
    totalFeeUsd: number | null
    totalSlippageBps: number | null
    status: 'success' | 'partial' | 'failed'
    errorReason: string | null
}

function mapStatus(dbStatus: string): 'success' | 'partial' | 'failed' {
    if (dbStatus === 'completed') return 'success'
    if (dbStatus === 'failed')    return 'failed'
    return 'partial'
}

function mapTriggerType(trigger: string, isAutomatic: boolean): 'manual' | 'auto' | 'circuit_breaker' {
    if (trigger.toLowerCase().includes('circuit')) return 'circuit_breaker'
    if (isAutomatic) return 'auto'
    return 'manual'
}

function rowToHistoryItem(r: RebalanceEventRow): PortfolioRebalanceHistoryItem {
    const details = (typeof r.details === 'object' && r.details !== null
        ? r.details
        : {}) as Record<string, unknown>

    return {
        id: r.id,
        portfolioId: r.portfolio_id,
        timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
        trigger: r.trigger,
        triggerType: mapTriggerType(r.trigger, r.is_automatic),
        assetsTrades: r.trades,
        totalFeeXlm: (details.gasFeeXlm as number | null | undefined) ?? null,
        totalFeeUsd: (details.gasFeeUsd as number | null | undefined) ?? null,
        totalSlippageBps: (details.totalSlippageBps as number | null | undefined)
            ?? (details.actualSlippageBps as number | null | undefined)
            ?? null,
        status: mapStatus(r.status),
        errorReason: r.error ?? null,
    }
}

export async function dbGetPortfolioRebalanceHistory(
    portfolioId: string,
    filter: PortfolioRebalanceHistoryFilter
): Promise<{ items: PortfolioRebalanceHistoryItem[]; total: number }> {
    const params: unknown[] = [portfolioId]
    const conditions: string[] = ['portfolio_id = $1']

    if (filter.from) {
        params.push(filter.from)
        conditions.push(`timestamp >= $${params.length}`)
    }
    if (filter.to) {
        params.push(filter.to)
        conditions.push(`timestamp <= $${params.length}`)
    }
    if (filter.trigger_type === 'auto') {
        conditions.push('is_automatic = true')
    } else if (filter.trigger_type === 'manual') {
        conditions.push('is_automatic = false')
        conditions.push("trigger NOT ILIKE '%circuit%'")
    } else if (filter.trigger_type === 'circuit_breaker') {
        conditions.push("trigger ILIKE '%circuit%'")
    }
    if (filter.status === 'success') {
        conditions.push("status = 'completed'")
    } else if (filter.status === 'failed') {
        conditions.push("status = 'failed'")
    } else if (filter.status === 'partial') {
        conditions.push("status = 'pending'")
    }

    const where = conditions.join(' AND ')
    const order = filter.sort === 'asc' ? 'ASC' : 'DESC'

    // Total count (for pagination metadata)
    const countResult = await query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM rebalance_events WHERE ${where}`,
        params
    )
    const total = parseInt(countResult.rows[0]?.count ?? '0', 10)

    // Data page
    params.push(filter.limit, filter.offset)
    const dataResult = await query<RebalanceEventRow>(
        `SELECT * FROM rebalance_events WHERE ${where} ORDER BY timestamp ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
    )

    return {
        items: dataResult.rows.map(rowToHistoryItem),
        total,
    }
}
