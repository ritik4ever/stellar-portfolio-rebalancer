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

/**
 * Backfill historical price points for a single asset from the price
 * oracle's market-chart history. The lookback window is clamped to the
 * configured bounds (default 90 days, min 1, max 365), so a large or
 * malformed `days` value can never trigger an unbounded history request.
 *
 * Called from the price-history-backfill BullMQ worker, typically right
 * after a new asset is added to the registry so its history exists before
 * the regular 5-minute snapshots start accumulating.
 */
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
