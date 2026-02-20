import { query } from './client.js'

export interface PortfolioRow {
    id: string
    user_address: string
    allocations: Record<string, number>
    threshold: number
    balances: Record<string, number>
    total_value: number
    created_at: Date
    last_rebalance: Date
}

function rowToPortfolio(r: PortfolioRow) {
    return {
        id: r.id,
        userAddress: r.user_address,
        allocations: r.allocations || {},
        threshold: r.threshold,
        balances: r.balances || {},
        totalValue: Number(r.total_value),
        createdAt: r.created_at.toISOString(),
        lastRebalance: r.last_rebalance.toISOString()
    }
}

export async function dbCreatePortfolio(
    id: string,
    userAddress: string,
    allocations: Record<string, number>,
    threshold: number,
    balances: Record<string, number>,
    totalValue: number
) {
    await query(
        `INSERT INTO portfolios (id, user_address, allocations, threshold, balances, total_value, created_at, last_rebalance)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [id, userAddress, JSON.stringify(allocations), threshold, JSON.stringify(balances), totalValue]
    )
}

export async function dbGetPortfolio(id: string) {
    const result = await query<PortfolioRow>(
        'SELECT * FROM portfolios WHERE id = $1',
        [id]
    )
    const row = result.rows[0]
    return row ? rowToPortfolio(row) : undefined
}

export async function dbGetUserPortfolios(userAddress: string) {
    const result = await query<PortfolioRow>(
        'SELECT * FROM portfolios WHERE user_address = $1 ORDER BY created_at ASC',
        [userAddress]
    )
    return result.rows.map(rowToPortfolio)
}

export async function dbGetAllPortfolios() {
    const result = await query<PortfolioRow>('SELECT * FROM portfolios ORDER BY created_at ASC')
    return result.rows.map(rowToPortfolio)
}

export async function dbUpdatePortfolio(
    id: string,
    updates: { balances?: Record<string, number>; totalValue?: number; lastRebalance?: string }
) {
    const sets: string[] = []
    const values: unknown[] = []
    let i = 1
    if (updates.balances !== undefined) {
        sets.push(`balances = $${i++}`)
        values.push(JSON.stringify(updates.balances))
    }
    if (updates.totalValue !== undefined) {
        sets.push(`total_value = $${i++}`)
        values.push(updates.totalValue)
    }
    if (updates.lastRebalance !== undefined) {
        sets.push(`last_rebalance = $${i++}`)
        values.push(updates.lastRebalance)
    }
    if (sets.length === 0) return false
    values.push(id)
    const result = await query(
        `UPDATE portfolios SET ${sets.join(', ')} WHERE id = $${i}`,
        values
    )
    return (result.rowCount ?? 0) > 0
}

export async function dbDeletePortfolio(id: string) {
    const result = await query('DELETE FROM portfolios WHERE id = $1', [id])
    return (result.rowCount ?? 0) > 0
}
