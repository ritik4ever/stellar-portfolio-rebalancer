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

export interface MarketMoverData {
    asset: string
    price: number
    change24h: number
}

export async function getMarketMoversData(assets: string[]): Promise<MarketMoverData[]> {
    const pool = getPool()
    if (!pool) return []
    
    const movers: MarketMoverData[] = []
    
    for (const asset of assets) {
        // Get latest snapshot
        const latestRes = await pool.query<{ price: number, recorded_at: Date }>(
            'SELECT price::float AS price, recorded_at FROM price_history WHERE asset = $1 ORDER BY recorded_at DESC LIMIT 1',
            [asset]
        )
        if (latestRes.rows.length === 0) continue
        
        const latest = latestRes.rows[0]
        
        // Get snapshot closest to 24h before the latest snapshot we found
        const latestAt = new Date(latest.recorded_at)
        const target24hAgo = new Date(latestAt.getTime() - 24 * 60 * 60 * 1000)
        const since = new Date(latestAt.getTime() - 26 * 60 * 60 * 1000)
        const until = new Date(latestAt.getTime() - 22 * 60 * 60 * 1000)
        
        const historicalRes = await pool.query<{ price: number, recorded_at: Date }>(
            `SELECT price::float AS price, recorded_at FROM price_history 
             WHERE asset = $1 AND recorded_at >= $2 AND recorded_at <= $3 
             ORDER BY ABS(EXTRACT(EPOCH FROM (recorded_at - $4))) ASC LIMIT 1`,
            [asset, since, until, target24hAgo]
        )
        
        if (historicalRes.rows.length === 0) {
            continue
        }
        
        const historical = historicalRes.rows[0]
        const priceDiff = latest.price - historical.price
        const change24h = historical.price > 0 ? (priceDiff / historical.price) * 100 : 0
        
        movers.push({
            asset,
            price: latest.price,
            change24h
        })
    }
    
    return movers
}

