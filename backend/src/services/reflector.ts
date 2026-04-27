import { SorobanRpc } from '@stellar/stellar-sdk'
import type { PricesMap, PriceData, PriceFeedMeta, PricesFeedPayload } from '../types/index.js'
import { getFeatureFlags } from '../config/featureFlags.js'
import { logger } from '../utils/logger.js'
import { assetRegistryService } from './assetRegistryService.js'

type PriceResolutionHint = PriceFeedMeta['resolutionHint']

const DEFAULT_SYMBOLS = ['XLM', 'BTC', 'ETH', 'USDC']
const DEFAULT_COIN_IDS: Record<string, string> = {
    'XLM': 'stellar',
    'BTC': 'bitcoin',
    'ETH': 'ethereum',
    'USDC': 'usd-coin'
}

export class ReflectorService {
    private coinGeckoApiKey: string
    private coinGeckoIds: Record<string, string>
    private priceCache: Map<string, { data: PriceData; cachedAtMs: number }>
    private readonly CACHE_DURATION = process.env.NODE_ENV === 'production' ? 600000 : 300000 // 10 min vs 5 min
    private lastRequestTime = 0
    private readonly MIN_REQUEST_INTERVAL = 90000 // Increased to 1.5 minutes for Pro API

    constructor() {
        this.coinGeckoApiKey = process.env.COINGECKO_API_KEY || ''
        this.priceCache = new Map()
        this.coinGeckoIds = { ...DEFAULT_COIN_IDS }
    }

    /** Asset list from registry; fallback to default 4 if registry empty */
    private getAssetList(): string[] {
        const symbols = assetRegistryService.getSymbols(true)
        return symbols.length > 0 ? symbols : DEFAULT_SYMBOLS
    }

    /** CoinGecko ID map from registry; fallback to default */
    private getCoinIdMap(): Record<string, string> {
        const map = assetRegistryService.getCoingeckoIdMap()
        return Object.keys(map).length > 0 ? map : { ...DEFAULT_COIN_IDS }
    }

    async getCurrentPrices(): Promise<PricesMap> {
        const { map } = await this.resolvePricesInternal()
        return this.applyQuoteAges(map)
    }

    async getCurrentPricesWithMeta(): Promise<PricesFeedPayload> {
        const { map, hint } = await this.resolvePricesInternal()
        const prices = this.applyQuoteAges(map)
        return { prices, feedMeta: this.buildFeedMeta(prices, hint) }
    }

    buildFeedMeta(prices: PricesMap, hint: PriceResolutionHint): PriceFeedMeta {
        const entries = Object.values(prices)
        const degraded =
            hint === 'synthetic_fallback'
            || entries.some((p) => p.dataTier === 'synthetic_fallback' || p.source === 'fallback')
        const staleOrLimited =
            hint === 'error_recovery_cache'
            || hint === 'rate_limited_cache'
        return {
            provider: 'backend',
            resolvedAtMs: Date.now(),
            degraded,
            staleOrLimited,
            resolutionHint: hint,
            assetsCount: Object.keys(prices).length
        }
    }

    private async resolvePricesInternal(): Promise<{ map: PricesMap; hint: PriceResolutionHint }> {
        try {
            logger.info('[DEBUG] Fetching prices from CoinGecko with smart caching')
            const assets = this.getAssetList()

            const cachedPrices = this.getCachedPrices(assets)
            if (Object.keys(cachedPrices).length === assets.length) {
                logger.info('[DEBUG] Using cached prices for all assets')
                return { map: cachedPrices, hint: 'cached_only' }
            }

            const now = Date.now()
            if (now - this.lastRequestTime < this.MIN_REQUEST_INTERVAL) {
                logger.info('[DEBUG] Rate limiting - using cached prices only')
                if (Object.keys(cachedPrices).length > 0) {
                    return { map: cachedPrices, hint: 'rate_limited_cache' }
                }
                if (getFeatureFlags().allowFallbackPrices) {
                    return { map: this.getFallbackPrices(), hint: 'synthetic_fallback' }
                }
                throw new Error('Price request rate-limited and ALLOW_FALLBACK_PRICES is disabled')
            }

            const coinIds = this.getCoinIdMap()
            const freshPrices = await this.getFreshPrices(assets, coinIds)
            const merged = { ...cachedPrices, ...freshPrices } as PricesMap
            const hint: PriceResolutionHint =
                Object.keys(freshPrices).length === assets.length
                    ? 'fresh_primary'
                    : Object.keys(cachedPrices).length > 0
                      ? 'partial_merge'
                      : 'fresh_primary'
            return { map: merged, hint }
        } catch (error) {
            logger.error('[ERROR] Price fetch failed', { error })

            const assets = this.getAssetList()
            const cachedPrices = this.getCachedPrices(assets)
            if (Object.keys(cachedPrices).length > 0) {
                logger.info('[DEBUG] Using cached prices due to API error')
                return { map: cachedPrices, hint: 'error_recovery_cache' }
            }

            if (!getFeatureFlags().allowFallbackPrices) {
                throw new Error('Price sources unavailable and ALLOW_FALLBACK_PRICES is disabled')
            }

            return { map: this.getFallbackPrices(), hint: 'synthetic_fallback' }
        }
    }

    finalizePriceMap(map: PricesMap): PricesMap {
        return this.applyQuoteAges(map)
    }

    private applyQuoteAges(map: PricesMap): PricesMap {
        const nowSec = Math.floor(Date.now() / 1000)
        const out: PricesMap = {}
        for (const [asset, row] of Object.entries(map)) {
            const tsSec = row.timestamp < 1e12 ? Math.floor(row.timestamp) : Math.floor(row.timestamp / 1000)
            const serverMs = row.serverFetchedAtMs ?? Date.now()
            out[asset] = {
                ...row,
                quoteAgeSeconds: Math.max(0, nowSec - tsSec),
                cacheAgeMs:
                    row.servedFromCache && row.serverFetchedAtMs !== undefined
                        ? Math.max(0, Date.now() - row.serverFetchedAtMs)
                        : undefined
            }
        }
        return out
    }

    private getCachedPrices(assets: string[]): PricesMap {
        const cachedPrices: PricesMap = {}
        const now = Date.now()

        assets.forEach(asset => {
            const cached = this.priceCache.get(asset)
            if (cached && (now - cached.cachedAtMs) < this.CACHE_DURATION) {
                const base = { ...cached.data }
                delete base.servedFromCache
                delete base.serverFetchedAtMs
                delete base.cacheAgeMs
                delete base.quoteAgeSeconds
                delete base.dataTier
                cachedPrices[asset] = {
                    ...base,
                    servedFromCache: true,
                    serverFetchedAtMs: cached.cachedAtMs,
                    cacheAgeMs: now - cached.cachedAtMs,
                    dataTier: base.source === 'fallback' ? 'synthetic_fallback' : 'cached_primary'
                }
            }
        })

        return cachedPrices
    }

    private async getFreshPrices(assets: string[], coinIds: Record<string, string>): Promise<PricesMap> {
        const now = Date.now()

        // Rate limiting - don't make requests too frequently
        if (now - this.lastRequestTime < this.MIN_REQUEST_INTERVAL) {
            logger.info('[DEBUG] Rate limiting - using cached prices')
            return {}
        }

        this.lastRequestTime = now

        try {
            const apiKey = this.coinGeckoApiKey

            // FIXED: Use correct API endpoints
            const baseUrl = 'https://api.coingecko.com/api/v3'
            logger.info('[DEBUG] Using API', { api: apiKey ? 'CoinGecko Pro' : 'CoinGecko Free' })
            logger.info('[DEBUG] Base URL', { baseUrl })

            const headers: Record<string, string> = {
                'Accept': 'application/json',
                'User-Agent': 'StellarPortfolioRebalancer/1.0'
            }

            // FIXED: Build correct coin IDs from registry map
            const coinIdsParam = assets
                .map(asset => coinIds[asset])
                .filter(Boolean)
                .join(',')

            logger.info('[DEBUG] Coin IDs', { coinIds: coinIdsParam })

            // FIXED: Correct API endpoint and parameters
            const endpoint = '/simple/price'
            const params = new URLSearchParams({
                'ids': coinIdsParam,
                'vs_currencies': 'usd',
                'include_24hr_change': 'true',
                'include_last_updated_at': 'true'
            })

            const url = `${baseUrl}${endpoint}?${params.toString()}`
            logger.info('[DEBUG] Full URL', { url })
            logger.info('[DEBUG] Headers', { headers })

            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 15000)

            const response = await fetch(url, {
                headers,
                method: 'GET',
                signal: controller.signal
            })

            clearTimeout(timeoutId)

            logger.info('[DEBUG] Response status', { status: response.status })
            logger.info('[DEBUG] Response headers', { headers: Object.fromEntries(response.headers.entries()) })

            if (!response.ok) {
                // Get the actual error response
                const errorText = await response.text()
                logger.error('[ERROR] CoinGecko API error response', { error: errorText })

                if (response.status === 429) {
                    logger.warn('[ERROR] CoinGecko rate limit exceeded')
                    throw new Error('Rate limit exceeded')
                }

                if (response.status === 401) {
                    logger.error('[ERROR] CoinGecko API key invalid')
                    throw new Error('Invalid API key')
                }

                if (response.status === 400) {
                    logger.error('[ERROR] CoinGecko bad request - check parameters')
                    throw new Error(`Bad request: ${errorText}`)
                }

                throw new Error(`CoinGecko API error: ${response.status} - ${errorText}`)
            }

            const data = await response.json()
            logger.info('[DEBUG] CoinGecko response data', { data })

            const prices: PricesMap = {}

            assets.forEach(asset => {
                const coinId = coinIds[asset]
                const coinData = data[coinId]

                if (coinData && coinData.usd !== undefined) {
                    const priceData: PriceData = {
                        price: coinData.usd || 0,
                        change: coinData.usd_24h_change || 0,
                        timestamp: coinData.last_updated_at || Math.floor(Date.now() / 1000),
                        source: apiKey ? 'coingecko_pro' : 'coingecko_free',
                        volume: coinData.usd_24h_vol || 0,
                        servedFromCache: false,
                        serverFetchedAtMs: Date.now(),
                        dataTier: 'primary'
                    }

                    prices[asset] = priceData

                    this.priceCache.set(asset, {
                        data: {
                            price: priceData.price,
                            change: priceData.change,
                            timestamp: priceData.timestamp,
                            source: priceData.source,
                            volume: priceData.volume
                        },
                        cachedAtMs: Date.now()
                    })

                    logger.info('[SUCCESS] Fresh price', {
                        asset,
                        price: priceData.price,
                        change: priceData.change
                    })
                } else {
                    logger.warn('[WARNING] No data received for asset', { asset, coinId })
                }
            })

            if (Object.keys(prices).length === 0) {
                throw new Error('No valid price data received from CoinGecko')
            }

            return prices
        } catch (error) {
            logger.error('[ERROR] Fresh price fetch failed', { error })
            throw error
        }
    }

    async getDetailedMarketData(asset: string): Promise<any> {
        try {
            const coinIds = this.getCoinIdMap()
            const coinId = coinIds[asset]
            if (!coinId) throw new Error(`Unsupported asset: ${asset}`)

            const apiKey = this.coinGeckoApiKey
            const baseUrl = apiKey && apiKey.trim()
                ? 'https://pro-api.coingecko.com/api/v3'
                : 'https://api.coingecko.com/api/v3'

            const headers: Record<string, string> = {
                'Accept': 'application/json',
                'User-Agent': 'StellarPortfolioRebalancer/1.0'
            }

            if (apiKey && apiKey.trim()) {
                headers['x-cg-pro-api-key'] = apiKey.trim()
            }

            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 15000)

            const response = await fetch(
                `${baseUrl}/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`,
                {
                    headers,
                    signal: controller.signal
                }
            )

            clearTimeout(timeoutId)

            if (!response.ok) {
                throw new Error(`CoinGecko detailed API error: ${response.status}`)
            }

            const data = await response.json()

            return {
                asset,
                name: data.name,
                symbol: data.symbol.toUpperCase(),
                price: data.market_data.current_price.usd,
                change_24h: data.market_data.price_change_percentage_24h,
                change_7d: data.market_data.price_change_percentage_7d,
                change_30d: data.market_data.price_change_percentage_30d,
                volume_24h: data.market_data.total_volume.usd,
                market_cap: data.market_data.market_cap.usd,
                market_cap_rank: data.market_data.market_cap_rank,
                high_24h: data.market_data.high_24h.usd,
                low_24h: data.market_data.low_24h.usd,
                source: 'coingecko_detailed',
                last_updated: data.last_updated
            }
        } catch (error) {
            logger.error('Failed to get detailed data for asset', { asset, error })
            throw error
        }
    }

    async getPriceHistory(asset: string, days: number = 7): Promise<Array<{ timestamp: number, price: number }>> {
        try {
            const coinIds = this.getCoinIdMap()
            const coinId = coinIds[asset]
            if (!coinId) throw new Error(`Unsupported asset: ${asset}`)

            const apiKey = this.coinGeckoApiKey
            const baseUrl = apiKey && apiKey.trim()
                ? 'https://pro-api.coingecko.com/api/v3'
                : 'https://api.coingecko.com/api/v3'

            const headers: Record<string, string> = {
                'Accept': 'application/json',
                'User-Agent': 'StellarPortfolioRebalancer/1.0'
            }

            if (apiKey && apiKey.trim()) {
                headers['x-cg-pro-api-key'] = apiKey.trim()
            }

            let interval = 'daily'
            if (days <= 1) interval = 'minutely'
            else if (days <= 7) interval = 'hourly'

            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 15000)

            const response = await fetch(
                `${baseUrl}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=${interval}`,
                {
                    headers,
                    signal: controller.signal
                }
            )

            clearTimeout(timeoutId)

            if (!response.ok) {
                throw new Error(`CoinGecko history API error: ${response.status}`)
            }

            const data = await response.json()

            return data.prices.map(([timestamp, price]: [number, number]) => ({
                timestamp: Math.floor(timestamp / 1000),
                price
            }))
        } catch (error) {
            logger.error('Failed to get price history for asset', { asset, error })
            if (!getFeatureFlags().allowMockPriceHistory) {
                throw new Error(`Price history unavailable for ${asset} and ALLOW_MOCK_PRICE_HISTORY is disabled`)
            }
            return this.generateMockHistory(asset, days * 24)
        }
    }

    private generateMockHistory(asset: string, hours: number): Array<{ timestamp: number, price: number }> {
        const history = []
        const now = Date.now()
        const hourInMs = 60 * 60 * 1000

        const basePrices: Record<string, number> = {
            'XLM': 0.354,
            'BTC': 110000,
            'ETH': 4200,
            'USDC': 1.0
        }
        const assets = this.getAssetList()
        assets.forEach(sym => {
            if (basePrices[sym] === undefined) basePrices[sym] = 1
        })

        const basePrice = basePrices[asset] || 1

        for (let i = hours; i >= 0; i--) {
            const timestamp = now - (i * hourInMs)
            const variation = (Math.random() - 0.5) * 0.04
            const price = basePrice * (1 + variation)

            history.push({
                timestamp: Math.floor(timestamp / 1000),
                price: price
            })
        }

        return history
    }

    private getFallbackPrices(): PricesMap {
        logger.warn('[FALLBACK] Using fallback prices - all sources failed')

        const assets = this.getAssetList()
        const addVariation = (basePrice: number) => {
            const variation = (Math.random() - 0.5) * 0.02
            return basePrice * (1 + variation)
        }

        const now = Math.floor(Date.now() / 1000)
        const defaultPrices: Record<string, { price: number; changeRange: number }> = {
            XLM: { price: 0.354, changeRange: 4 },
            USDC: { price: 1.0, changeRange: 0.1 },
            BTC: { price: 110000, changeRange: 6 },
            ETH: { price: 4200, changeRange: 5 }
        }

        const result: PricesMap = {}
        assets.forEach(asset => {
            const def = defaultPrices[asset] || { price: 1, changeRange: 2 }
            result[asset] = {
                price: addVariation(def.price),
                change: (Math.random() - 0.5) * def.changeRange,
                timestamp: now,
                source: 'fallback',
                servedFromCache: false,
                serverFetchedAtMs: Date.now(),
                dataTier: 'synthetic_fallback'
            }
        })
        return result
    }

    async testApiConnectivity(): Promise<{ success: boolean, error?: string, data?: any }> {
        try {
            const apiKey = this.coinGeckoApiKey
            const baseUrl = apiKey && apiKey.trim()
                ? 'https://pro-api.coingecko.com/api/v3'
                : 'https://api.coingecko.com/api/v3'

            const headers: Record<string, string> = {
                'Accept': 'application/json',
                'User-Agent': 'StellarPortfolioRebalancer/1.0'
            }

            if (apiKey && apiKey.trim()) {
                headers['x-cg-pro-api-key'] = apiKey.trim()
            }

            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 10000)

            const response = await fetch(
                `${baseUrl}/simple/price?ids=bitcoin&vs_currencies=usd`,
                {
                    headers,
                    signal: controller.signal
                }
            )

            clearTimeout(timeoutId)

            const data = await response.json()

            return {
                success: response.ok,
                data: {
                    status: response.status,
                    response: data,
                    headers: Object.fromEntries(response.headers.entries())
                }
            }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            }
        }
    }

    clearCache(): void {
        this.priceCache.clear()
        logger.info('[DEBUG] Price cache cleared')
    }

    getCacheStatus(): Record<string, any> {
        const status: Record<string, any> = {}
        this.priceCache.forEach((value, key) => {
            status[key] = {
                cached: true,
                age: Date.now() - value.cachedAtMs,
                price: value.data.price,
                source: value.data.source
            }
        })
        return status
    }
}
