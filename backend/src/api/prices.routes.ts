import { Router, Request, Response } from 'express'
import { getPool } from '../db/client.js'
import { ohlcvQuerySchema } from './validation.js'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import { ok, fail } from '../utils/apiResponse.js'

export const pricesRouter = Router()

interface PriceRow {
    price: number
    recorded_at: Date
}

export interface OhlcvCandle {
    timestamp: number
    open: number
    high: number
    low: number
    close: number
}

interface CacheEntry {
    data: OhlcvCandle[]
    expiresAt: number
}

const ohlcvCache = new Map<string, CacheEntry>()
const OLCV_CACHE_TTL_MS = 10 * 60 * 1000

const INTERVAL_MS: Record<string, number> = {
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
}

function cacheKey(asset: string, interval: string, from: string, to: string): string {
    return `${asset}|${interval}|${from}|${to}`
}

pricesRouter.get('/prices/ohlcv', async (req: Request, res: Response) => {
    try {
        const parsed = ohlcvQuerySchema.safeParse(req.query)
        if (!parsed.success) {
            const message = parsed.error.issues
                .map(issue => `${issue.path.join('.') || 'query'}: ${issue.message}`)
                .join('; ')
            return fail(res, 400, 'VALIDATION_ERROR', message)
        }

        const { asset, interval, from, to } = parsed.data
        const key = cacheKey(asset, interval, from, to)
        const now = Date.now()

        const cached = ohlcvCache.get(key)
        if (cached && cached.expiresAt > now) {
            return ok(res, { asset, interval, candles: cached.data })
        }

        const pool = getPool()
        if (!pool) {
            return fail(res, 503, 'SERVICE_UNAVAILABLE', 'Database not available')
        }

        const fromDate = new Date(from)
        const toDate = new Date(to)

        const dbResult = await pool.query<PriceRow>(
            `SELECT price::float AS price, recorded_at
             FROM price_history
             WHERE asset = $1 AND recorded_at >= $2 AND recorded_at <= $3
             ORDER BY recorded_at ASC`,
            [asset, fromDate, toDate],
        )

        const rows = dbResult.rows
        const intervalMs = INTERVAL_MS[interval]
        const startMs = Math.floor(fromDate.getTime() / intervalMs) * intervalMs
        const endMs = Math.ceil(toDate.getTime() / intervalMs) * intervalMs

        const candles: OhlcvCandle[] = []
        let idx = 0
        let previousClose: number | null = null

        for (let bucketStart = startMs; bucketStart < endMs; bucketStart += intervalMs) {
            const bucketEnd = bucketStart + intervalMs
            const bucketPrices: number[] = []

            while (idx < rows.length) {
                const t = new Date(rows[idx].recorded_at).getTime()
                if (t >= bucketEnd) break
                bucketPrices.push(rows[idx].price)
                idx++
            }

            if (bucketPrices.length > 0) {
                const first = bucketPrices[0]
                const last = bucketPrices[bucketPrices.length - 1]
                let high = first
                let low = first
                for (let i = 1; i < bucketPrices.length; i++) {
                    if (bucketPrices[i] > high) high = bucketPrices[i]
                    if (bucketPrices[i] < low) low = bucketPrices[i]
                }

                candles.push({
                    timestamp: bucketStart,
                    open: first,
                    high,
                    low,
                    close: last,
                })
                previousClose = last
            } else if (previousClose !== null) {
                candles.push({
                    timestamp: bucketStart,
                    open: previousClose,
                    high: previousClose,
                    low: previousClose,
                    close: previousClose,
                })
            }
        }

        ohlcvCache.set(key, { data: candles, expiresAt: now + OLCV_CACHE_TTL_MS })

        return ok(res, { asset, interval, candles })
    } catch (error) {
        logger.error('[OHLCV] Failed to compute candles', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})
