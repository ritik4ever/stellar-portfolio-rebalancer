import { getPool } from './client.js'
import { logger } from '../utils/logger.js'

export interface PriceSnapshot {
    id: number
    asset: string
    price: number
    recorded_at: Date
}

export async function insertPriceSnapshot(asset: string, price: number): Promise<void> {
    const pool = getPool()
    if (!pool) return
    await pool.query(
        'INSERT INTO price_history (asset, price, recorded_at) VALUES ($1, $2, NOW())',
        [asset, price],
    )
}

export async function getPriceHistory(
    asset: string,
    since: Date,
): Promise<PriceSnapshot[]> {
    const pool = getPool()
    if (!pool) return []
    const result = await pool.query<PriceSnapshot>(
        'SELECT id, asset, price::float AS price, recorded_at FROM price_history WHERE asset = $1 AND recorded_at >= $2 ORDER BY recorded_at DESC',
        [asset, since],
    )
    return result.rows
}

export async function pruneOldPriceSnapshots(olderThanDays = 90): Promise<number> {
    const pool = getPool()
    if (!pool) return 0
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)
    const result = await pool.query(
        'DELETE FROM price_history WHERE recorded_at < $1',
        [cutoff],
    )
    const deleted = result.rowCount ?? 0
    logger.info('[priceHistory] Pruned old snapshots', { deleted, cutoffDays: olderThanDays })
    return deleted
}
