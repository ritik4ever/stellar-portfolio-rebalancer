import { ReflectorService } from './reflector.js'
import { insertPriceSnapshot, insertPriceSnapshotsAt, pruneOldPriceSnapshots } from '../db/priceHistoryDb.js'
import {
    getPriceHistoryConfig,
    PRICE_HISTORY_BACKFILL_MAX_DAYS,
    PRICE_HISTORY_BACKFILL_MIN_DAYS,
} from '../config/priceHistoryConfig.js'
import { logger } from '../utils/logger.js'

const TRACKED_ASSETS = ['XLM', 'BTC', 'ETH', 'USDC']

const reflector = new ReflectorService()


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


export async function backfillPriceHistory(
    asset: string,
    days?: number,
): Promise<{ asset: string; backfilled: number; days: number }> {
    const requestedDays =
        typeof days === 'number' && Number.isFinite(days)
            ? days
            : getPriceHistoryConfig().backfillDays

    const windowDays = Math.min(
        Math.max(requestedDays, PRICE_HISTORY_BACKFILL_MIN_DAYS),
        PRICE_HISTORY_BACKFILL_MAX_DAYS,
    )

    let history: Array<{ timestamp: number; price: number }>
    try {
        history = await reflector.getPriceHistory(asset, windowDays)
    } catch (err) {
        logger.warn('[priceHistory] Backfill failed to fetch history', {
            asset,
            days: windowDays,
            error: err instanceof Error ? err.message : String(err),
        })
        return { asset, backfilled: 0, days: windowDays }
    }

    if (!history || history.length === 0) {
        return { asset, backfilled: 0, days: windowDays }
    }

    const backfilled = await insertPriceSnapshotsAt(asset, history)
    logger.info('[priceHistory] Backfill complete', {
        asset,
        backfilled,
        days: windowDays,
    })
    return { asset, backfilled, days: windowDays }
}
