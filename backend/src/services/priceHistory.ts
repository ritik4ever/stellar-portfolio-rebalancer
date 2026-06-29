import { ReflectorService } from './reflector.js'
import { insertPriceSnapshot, pruneOldPriceSnapshots } from '../db/priceHistoryDb.js'
import { logger } from '../utils/logger.js'

const TRACKED_ASSETS = ['XLM', 'BTC', 'ETH', 'USDC']

const reflector = new ReflectorService()

/**
 * Snapshot current oracle prices for all tracked assets and persist them.
 * Called every 5 minutes by the price-history BullMQ worker.
 */
export async function snapshotPrices(): Promise<void> {
    let prices: Record<string, number>
    try {
        prices = await reflector.getCurrentPrices()
    } catch (err) {
        logger.warn('[priceHistory] Failed to fetch prices — snapshot skipped', {
            error: err instanceof Error ? err.message : String(err),
        })
        return
    }

    for (const asset of TRACKED_ASSETS) {
        const price = prices[asset]
        if (price == null || !Number.isFinite(price)) continue
        try {
            await insertPriceSnapshot(asset, price)
        } catch (err) {
            logger.error('[priceHistory] Failed to persist snapshot', {
                asset,
                error: err instanceof Error ? err.message : String(err),
            })
        }
    }

    logger.info('[priceHistory] Price snapshot stored', {
        assets: TRACKED_ASSETS.filter((a) => prices[a] != null),
    })
}

/**
 * Prune snapshots older than 90 days.
 * Called daily by the price-history-prune BullMQ worker.
 */
export async function pruneStaleSnapshots(): Promise<void> {
    const deleted = await pruneOldPriceSnapshots(90)
    logger.info('[priceHistory] Daily prune complete', { deleted })
}
