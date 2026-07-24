import { Router, Request, Response } from 'express'
import { assetRegistryService } from '../services/assetRegistryService.js'
import { getMarketMoversData } from '../db/priceHistoryDb.js'
import { ok, fail } from '../utils/apiResponse.js'
import { logger } from '../utils/logger.js'

export const marketRouter = Router()

interface MoversResponse {
    gainers: {
        symbol: string
        name: string
        price: number
        change24h: number
    }[]
    losers: {
        symbol: string
        name: string
        price: number
        change24h: number
    }[]
}

interface CacheEntry {
    data: MoversResponse
    expiresAt: number
}

let cache: CacheEntry | null = null
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

marketRouter.get('/market/movers', async (req: Request, res: Response) => {
    try {
        const now = Date.now()
        if (process.env.NODE_ENV !== 'test' && cache && cache.expiresAt > now) {
            return ok(res, cache.data)
        }

        // Get enabled assets
        const activeAssets = assetRegistryService.list(true)
        const symbols = activeAssets.map(a => a.symbol)

        if (symbols.length === 0) {
            const emptyResult = { gainers: [], losers: [] }
            return ok(res, emptyResult)
        }

        // Fetch movers data from db price snapshots
        const moversData = await getMarketMoversData(symbols)

        // Map asset info (name) back
        const mappedMovers = moversData.map(mover => {
            const assetInfo = activeAssets.find(a => a.symbol === mover.asset)
            return {
                symbol: mover.asset,
                name: assetInfo?.name || mover.asset,
                price: mover.price,
                change24h: mover.change24h
            }
        })

        // Sort by % change
        // Gainers: change24h > 0, sorted descending
        // Losers: change24h < 0, sorted ascending
        const gainers = mappedMovers
            .filter(m => m.change24h > 0)
            .sort((a, b) => b.change24h - a.change24h)
            .slice(0, 5)

        const losers = mappedMovers
            .filter(m => m.change24h < 0)
            .sort((a, b) => a.change24h - b.change24h)
            .slice(0, 5)

        const responseData: MoversResponse = { gainers, losers }

        cache = {
            data: responseData,
            expiresAt: now + CACHE_TTL
        }

        return ok(res, responseData)
    } catch (error) {
        logger.error('[ERROR] Failed to get market movers', { error })
        return fail(res, 500, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error))
    }
})
