import { query } from './client.js'
import { ConflictError } from '../types/index.js'

export interface PortfolioRow {
    id: string
    user_address: string
    allocations: Record<string, number>
    threshold: number
    slippage_tolerance?: number
    balances: Record<string, number>
    total_value: number
    created_at: Date
    last_rebalance: Date
    version: number
}

function rowToPortfolio(r: PortfolioRow) {
    return {
        id: r.id,
        userAddress: r.user_address,
        allocations: r.allocations || {},
        threshold: r.threshold,
        slippageTolerance: r.slippage_tolerance != null ? Number(r.slippage_tolerance) : 1,
        balances: r.balances || {},
        totalValue: Number(r.total_value),
        createdAt: r.created_at.toISOString(),
        lastRebalance: r.last_rebalance.toISOString(),
        version: r.version ?? 1
    }
}

export async function dbCreatePortfolio(
    id: string,
    userAddress: string,
    allocations: Record<string, number>,
    threshold: number,
    balances: Record<string, number>,
    totalValue: number,
    slippageTolerance: number = 1
) {
    await query(
        `INSERT INTO portfolios (id, user_address, allocations, threshold, slippage_tolerance, balances, total_value, created_at, last_rebalance, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), 1)`,
        [id, userAddress, JSON.stringify(allocations), threshold, slippageTolerance, JSON.stringify(balances), totalValue]
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

/**
 * Update a portfolio record.
 *
 * When `expectedVersion` is provided the update uses compare-and-set semantics:
 * the row is only modified when its current version matches `expectedVersion`,
 * and the version counter is incremented atomically.  A `ConflictError` is
 * thrown when the match fails, signalling that a concurrent write has already
 * advanced the version.
 *
 * Omitting `expectedVersion` performs an unchecked update (backward-compat)
 * while still incrementing the version so that subsequent versioned callers
 * detect the change.
 */
export async function dbUpdatePortfolio(
    id: string,
    updates: { balances?: Record<string, number>; totalValue?: number; lastRebalance?: string },
    expectedVersion?: number
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

    // Always increment the version counter on every write
    sets.push(`version = version + 1`)

    if (expectedVersion !== undefined) {
        // Compare-and-set: WHERE id = $n AND version = $m
        values.push(id)
        values.push(expectedVersion)
        const result = await query(
            `UPDATE portfolios SET ${sets.join(', ')} WHERE id = $${i} AND version = $${i + 1}`,
            values
        )
        if ((result.rowCount ?? 0) === 0) {
            // Distinguish not-found from conflict
            const check = await query<{ id: string }>(
                'SELECT id FROM portfolios WHERE id = $1',
                [id]
            )
            if (check.rows.length === 0) return false
            // Row exists but version didn't match — concurrent write detected
            const current = await query<{ version: number }>(
                'SELECT version FROM portfolios WHERE id = $1',
                [id]
            )
            throw new ConflictError(current.rows[0]?.version ?? -1)
        }
        return true
    }

    // Unchecked update
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
