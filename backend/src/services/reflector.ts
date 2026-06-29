import type { PricesMap, PriceData, PriceFeedMeta, PricesFeedPayload } from '../types/index.js'
import { getFeatureFlags } from '../config/featureFlags.js'
import { logger } from '../utils/logger.js'
import { recordCacheTtl, recordPriceFeedResolution, recordReflectorFallbackUsage, recordReflectorStalePrice, recordCacheOperation, recordCacheExpiration, recordCacheAge, recordCacheHitRatio, recordCacheSize, recordCacheEntries } from '../observability/metrics.js'
import { assetRegistryService } from './assetRegistryService.js'
import { REDIS_URL } from '../queue/connection.js'
import { databaseService } from './databaseService.js'


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
    private reflectorApiUrl: string
    private readonly PRICE_DATA_MAX_AGE = Number.parseInt(process.env.PRICE_DATA_MAX_AGE || '600', 10)
    private readonly CACHE_DURATION = process.env.NODE_ENV === 'production' ? 600000 : 300000 // 10 min vs 5 min
    private lastRequestTime = 0
    private readonly MIN_REQUEST_INTERVAL = 90000 // Increased to 1.5 minutes for Pro API
    private readonly oracleCacheTtlSeconds: number

    // Cache metrics tracking
    private cacheStats: Map<string, { hits: number; misses: number; lastAgeMs: number }> = new Map()
    private cacheMetricsReportInterval: NodeJS.Timer | null = null
    private redisCache: Awaited<ReturnType<typeof import('ioredis').default>> | null = null
    private redisAvailable: boolean = false
    private readonly ORACLE_CACHE_KEY = 'oracle:prices'

    constructor() {
        this.coinGeckoApiKey = process.env.COINGECKO_API_KEY || ''
        this.priceCache = new Map()
        this.coinGeckoIds = { ...DEFAULT_COIN_IDS }
        this.reflectorApiUrl = process.env.REFLECTOR_API_URL || ''

        const rawTtl = Number.parseInt(process.env.ORACLE_CACHE_TTL_SECONDS || '30', 10)
        this.oracleCacheTtlSeconds = Number.isFinite(rawTtl) && rawTtl >= 0 ? rawTtl : 30

        // Initialize cache metrics reporting
        this.startCacheMetricsReporting()
        
        // Record initial TTL configuration
        recordCacheTtl(Math.floor(this.CACHE_DURATION / 1000))
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
        const { map, hint, cacheStatus } = await this.resolvePricesWithRedisCache()
        return this.applyQuoteAges(map)
    }

    async getCurrentPricesWithMeta(): Promise<PricesFeedPayload> {
        const { map, hint, cacheStatus } = await this.resolvePricesWithRedisCache()
        const prices = this.applyQuoteAges(map)
        return { prices, feedMeta: this.buildFeedMeta(prices, hint, cacheStatus) }
    }

    buildFeedMeta(prices: PricesMap, hint: PriceResolutionHint, cacheStatus?: PriceFeedMeta['cacheStatus']): PriceFeedMeta {
        const entries = Object.values(prices)
        const degraded =
            hint === 'synthetic_fallback'
            || entries.some((p) => p.dataTier === 'synthetic_fallback' || p.source === 'fallback')
        const staleOrLimited =
            hint === 'error_recovery_cache'
            || hint === 'rate_limited_cache'
        const meta: PriceFeedMeta = {
            provider: 'backend',
            resolvedAtMs: Date.now(),
            degraded,
            staleOrLimited,
            resolutionHint: hint,
            assetsCount: Object.keys(prices).length,
            cacheStatus
        }
        recordPriceFeedResolution(meta)
        return meta
    }

    private async getRedisCache() {
        if (this.redisCache) return this.redisCache
        try {
            const { default: IORedis } = await import('ioredis')
            this.redisCache = new IORedis(REDIS_URL, {
                lazyConnect: true,
                connectTimeout: 2000,
                maxRetriesPerRequest: 1,
                enableReadyCheck: false,
                retryStrategy: () => null
            })
            this.redisCache.on('error', () => {})
            await this.redisCache.connect()
            await this.redisCache.ping()
            this.redisAvailable = true
        } catch {
            this.redisAvailable = false
            this.redisCache = null
        }
        return this.redisCache
    }

    private async readFromRedisCache(): Promise<{ map: PricesMap; cacheStatus: PriceFeedMeta['cacheStatus'] } | null> {
        if (this.oracleCacheTtlSeconds === 0) return null
        try {
            const redis = await this.getRedisCache()
            if (!redis) return { map: {}, cacheStatus: 'redis_unavailable' }
            const raw = await redis.get(this.ORACLE_CACHE_KEY)
            if (!raw) return { map: {}, cacheStatus: 'redis_miss' }
            const map = JSON.parse(raw) as PricesMap
            if (typeof map === 'object' && map !== null && Object.keys(map).length > 0) {
                return { map, cacheStatus: 'redis_hit' }
            }
            return { map: {}, cacheStatus: 'redis_miss' }
        } catch {
            return { map: {}, cacheStatus: 'redis_unavailable' }
        }
    }

    private async writeToRedisCache(map: PricesMap): Promise<void> {
        if (this.oracleCacheTtlSeconds === 0 || Object.keys(map).length === 0) return
        try {
            const redis = await this.getRedisCache()
            if (!redis) return
            const stripped: PricesMap = {}
            for (const [asset, data] of Object.entries(map)) {
                stripped[asset] = {
                    price: data.price,
                    change: data.change,
                    timestamp: data.timestamp,
                    source: data.source,
                    volume: data.volume
                }
            }
            await redis.set(this.ORACLE_CACHE_KEY, JSON.stringify(stripped), 'EX', this.oracleCacheTtlSeconds)
        } catch {
            // Redis write failed — graceful degradation
        }
    }

    private async resolvePricesWithRedisCache(): Promise<{ map: PricesMap; hint: PriceResolutionHint; cacheStatus: PriceFeedMeta['cacheStatus'] }> {
        if (this.oracleCacheTtlSeconds === 0) {
            const result = await this.resolvePricesInternal()
            return { ...result, cacheStatus: 'redis_bypassed' }
        }

        const redisResult = await this.readFromRedisCache()
        if (redisResult?.cacheStatus === 'redis_hit' && Object.keys(redisResult.map).length > 0) {
            return { map: redisResult.map, hint: 'cached_only', cacheStatus: 'redis_hit' }
        }

        const resolved = await this.resolvePricesInternal()
        const cacheStatus: PriceFeedMeta['cacheStatus'] = redisResult?.cacheStatus === 'redis_unavailable' ? 'redis_unavailable' : 'redis_miss'

        if (Object.keys(resolved.map).length > 0) {
            await this.writeToRedisCache(resolved.map)
        }

        return { ...resolved, cacheStatus }
    }

    private async resolvePricesInternal(): Promise<{ map: PricesMap; hint: PriceResolutionHint }> {
        try {
            logger.info('[DEBUG] Fetching prices with Reflector/CoinGecko and smart caching')
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
                    recordReflectorFallbackUsage('rate_limited_cache')
                    return { map: cachedPrices, hint: 'rate_limited_cache' }
                }
                if (getFeatureFlags().allowFallbackPrices) {
                    recordReflectorFallbackUsage('synthetic_fallback')
                    return { map: this.getFallbackPrices(), hint: 'synthetic_fallback' }
                }
                throw new Error('Price request rate-limited and ALLOW_FALLBACK_PRICES is disabled')
            }

            let reflectorPrices: PricesMap = {}
            try {
                reflectorPrices = await this.getReflectorPrices(assets)
            } catch (reflectorError) {
                logger.warn('[WARNING] Reflector fetch failed, falling back to CoinGecko', { reflectorError })
            }

            const missingAssets = assets.filter((asset) => reflectorPrices[asset] === undefined)
            const coinIds = this.getCoinIdMap()
            const freshPrices = missingAssets.length > 0
                ? await this.getFreshPrices(missingAssets, coinIds)
                : {}

            const merged = { ...cachedPrices, ...reflectorPrices, ...freshPrices } as PricesMap
            if (Object.keys(merged).length === 0) {
                throw new Error('No valid price data available from Reflector or CoinGecko')
            }

            const hint: PriceResolutionHint =
                Object.keys(reflectorPrices).length + Object.keys(freshPrices).length === assets.length
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
                recordReflectorFallbackUsage('error_recovery_cache')
                return { map: cachedPrices, hint: 'error_recovery_cache' }
            }

            if (!getFeatureFlags().allowFallbackPrices) {
                throw new Error('Price sources unavailable and ALLOW_FALLBACK_PRICES is disabled')
            }

            recordReflectorFallbackUsage('synthetic_fallback')
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
            const age = now - (cached?.cachedAtMs ?? now)

            if (cached && age < this.CACHE_DURATION) {
                // Cache hit
                recordCacheOperation('hit', asset)
                this.updateCacheStats(asset, true, age)

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
                    cacheAgeMs: age,
                    dataTier: base.source === 'fallback' ? 'synthetic_fallback' : 'cached_primary'
                }

                // Record cache age for this entry
                recordCacheAge(asset, age)
            } else {
                // Cache miss or expired
                if (cached) {
                    recordCacheExpiration(asset)
                }
                recordCacheOperation('miss', asset)
                this.updateCacheStats(asset, false, 0)
            }
        })

        return cachedPrices
    }

    private normalizeReflectorPrice(raw: string | number | bigint, decimals: number): number {
        const numeric = typeof raw === 'bigint' ? Number(raw) : Number(raw)
        if (!Number.isFinite(numeric)) {
            throw new Error('Invalid Reflector price value')
        }
        if (decimals <= 0) return numeric
        return numeric / (10 ** decimals)
    }

    private isPriceStale(timestamp: number): boolean {
        const tsSec = timestamp >= 1e12 ? Math.floor(timestamp / 1000) : Math.floor(timestamp)
        const nowSec = Math.floor(Date.now() / 1000)
        return (nowSec - tsSec) > this.PRICE_DATA_MAX_AGE
    }

    private async getReflectorPrices(assets: string[]): Promise<PricesMap> {
        if (!this.reflectorApiUrl) return {}

        const url = `${this.reflectorApiUrl.replace(/\/$/, '')}/prices?assets=${encodeURIComponent(assets.join(','))}`
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'StellarPortfolioRebalancer/1.0'
            }
        })

        if (!response.ok) {
            throw new Error(`Reflector API error: ${response.status}`)
        }

        const payload = await response.json() as {
            prices?: Record<string, { price: string | number | bigint; timestamp: number; decimals?: number; change?: number; volume?: number }>
        } | Record<string, { price: string | number | bigint; timestamp: number; decimals?: number; change?: number; volume?: number }>

        const rows: Record<string, { price: string | number | bigint; timestamp: number; decimals?: number; change?: number; volume?: number }> = ('prices' in payload && payload.prices)
            ? payload.prices
            : payload

        const out: PricesMap = {}
        let staleCount = 0

        assets.forEach((asset) => {
            const row = rows?.[asset]
            if (!row) return

            if (this.isPriceStale(row.timestamp)) {
                staleCount += 1
                recordReflectorStalePrice(asset)
                return
            }

            out[asset] = {
                price: this.normalizeReflectorPrice(row.price, row.decimals ?? 0),
                change: row.change ?? 0,
                timestamp: row.timestamp,
                source: 'reflector',
                volume: row.volume,
                servedFromCache: false,
                serverFetchedAtMs: Date.now(),
                dataTier: 'primary'
            }

            try {
                databaseService.setAssetFreshness(asset, new Date().toISOString(), false)
            } catch (err) {
                logger.error(`[ASSET-REGISTRY] Failed to update freshness for ${asset} during Reflector fetch`, { err })
            }
        })

        if (Object.keys(out).length === 0 && staleCount > 0) {
            throw new Error('Reflector data is stale')
        }

        return out
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

                    // Record cache update operation
                    recordCacheOperation('update', asset)

                    logger.info('[SUCCESS] Fresh price', {
                        asset,
                        price: priceData.price,
                        change: priceData.change
                    })

                    try {
                        databaseService.setAssetFreshness(asset, new Date().toISOString(), false)
                    } catch (err) {
                        logger.error(`[ASSET-REGISTRY] Failed to update freshness for ${asset} during CoinGecko fetch`, { err })
                    }
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

    /**
     * Update cache statistics for a specific asset.
     * Tracks hit/miss counts and ages for metrics reporting.
     */
    private updateCacheStats(asset: string, isHit: boolean, ageMs: number): void {
        const current = this.cacheStats.get(asset) || { hits: 0, misses: 0, lastAgeMs: 0 }
        if (isHit) {
            current.hits += 1
            current.lastAgeMs = ageMs
        } else {
            current.misses += 1
        }
        this.cacheStats.set(asset, current)
    }

    /**
     * Report cache metrics to observability system.
     * Called periodically to surface hit ratios and cache ages.
     */
    private reportCacheMetrics(): void {
        const assets = this.getAssetList()
        let totalCacheSizeBytes = 0

        assets.forEach(asset => {
            const stats = this.cacheStats.get(asset)
            if (stats) {
                const total = stats.hits + stats.misses
                const hitRatio = total > 0 ? stats.hits / total : 0
                recordCacheHitRatio(asset, hitRatio)

                logger.debug('[CACHE-METRICS]', {
                    asset,
                    hits: stats.hits,
                    misses: stats.misses,
                    hitRatio: hitRatio.toFixed(2),
                    lastAgeMs: stats.lastAgeMs
                })
            }

            // Estimate cache size: rough approximation based on price data
            const cached = this.priceCache.get(asset)
            if (cached) {
                // Rough estimate: asset name + price data structure
                totalCacheSizeBytes += asset.length + JSON.stringify(cached.data).length + 16
            }
        })

        recordCacheSize(totalCacheSizeBytes)
        recordCacheEntries(this.priceCache.size)

        logger.debug('[CACHE-STATUS]', {
            entries: this.priceCache.size,
            estimatedSizeBytes: totalCacheSizeBytes,
            ttlSeconds: Math.floor(this.CACHE_DURATION / 1000),
            maxAgeSeconds: this.PRICE_DATA_MAX_AGE
        })
    }

    /**
     * Start periodic cache metrics reporting.
     * Reports every 30 seconds to track cache behavior.
     */
    private startCacheMetricsReporting(): void {
        if (this.cacheMetricsReportInterval) {
            return
        }

        this.cacheMetricsReportInterval = setInterval(() => {
            try {
                this.reportCacheMetrics()
            } catch (error) {
                logger.error('[CACHE-METRICS] Reporting failed', { error })
            }
        }, 30000) // Report every 30 seconds

        // Ensure interval doesn't prevent process exit if no other handles
        if (this.cacheMetricsReportInterval.unref) {
            this.cacheMetricsReportInterval.unref()
        }
    }

    /**
     * Stop cache metrics reporting and cleanup.
     */
    stopCacheMetricsReporting(): void {
        if (this.cacheMetricsReportInterval) {
            clearInterval(this.cacheMetricsReportInterval)
            this.cacheMetricsReportInterval = null
        }
    }

    /**
     * Get detailed cache analytics for debugging/monitoring.
     */
    getCacheAnalytics(): {
        totalEntries: number
        assets: Array<{
            asset: string
            cached: boolean
            ageMs: number
            hitCount: number
            missCount: number
            hitRatio: number
            price: number | null
            source: string | null
        }>
        estimatedSizeBytes: number
        ttlMs: number
        maxAgeSeconds: number
    } {
        const assets = this.getAssetList()
        let totalSize = 0

        const analyticsAssets = assets.map(asset => {
            const cached = this.priceCache.get(asset)
            const stats = this.cacheStats.get(asset)
            const ageMs = cached ? Date.now() - cached.cachedAtMs : 0

            if (cached) {
                totalSize += asset.length + JSON.stringify(cached.data).length + 16
            }

            const total = (stats?.hits ?? 0) + (stats?.misses ?? 0)
            return {
                asset,
                cached: !!cached,
                ageMs,
                hitCount: stats?.hits ?? 0,
                missCount: stats?.misses ?? 0,
                hitRatio: total > 0 ? (stats?.hits ?? 0) / total : 0,
                price: cached?.data.price ?? null,
                source: cached?.data.source ?? null
            }
        })

        return {
            totalEntries: this.priceCache.size,
            assets: analyticsAssets,
            estimatedSizeBytes: totalSize,
            ttlMs: this.CACHE_DURATION,
            maxAgeSeconds: this.PRICE_DATA_MAX_AGE
        }
    }

    /**
     * Tune cache TTL and staleness settings at runtime.
     * Returns the new configuration or error if invalid.
     */
    tuneCacheSettings(options: {
        cacheDurationMs?: number
        priceDataMaxAgeSeconds?: number
    }): { success: boolean; message: string; config?: { cacheDurationMs: number; maxAgeSeconds: number } } {
        try {
            if (options.cacheDurationMs !== undefined) {
                if (!Number.isInteger(options.cacheDurationMs) || options.cacheDurationMs < 1000) {
                    return {
                        success: false,
                        message: 'cacheDurationMs must be an integer >= 1000 (1 second minimum)'
                    }
                }
                (this as any).CACHE_DURATION = options.cacheDurationMs
                recordCacheTtl(Math.floor(options.cacheDurationMs / 1000))
            }

            if (options.priceDataMaxAgeSeconds !== undefined) {
                if (!Number.isInteger(options.priceDataMaxAgeSeconds) || options.priceDataMaxAgeSeconds < 60) {
                    return {
                        success: false,
                        message: 'priceDataMaxAgeSeconds must be an integer >= 60'
                    }
                }
                (this as any).PRICE_DATA_MAX_AGE = options.priceDataMaxAgeSeconds
            }

            logger.info('[CACHE-TUNING] Settings updated', {
                cacheDurationMs: (this as any).CACHE_DURATION,
                maxAgeSeconds: (this as any).PRICE_DATA_MAX_AGE
            })

            return {
                success: true,
                message: 'Cache settings tuned successfully',
                config: {
                    cacheDurationMs: (this as any).CACHE_DURATION,
                    maxAgeSeconds: (this as any).PRICE_DATA_MAX_AGE
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            logger.error('[CACHE-TUNING] Failed to tune settings', { error: message })
            return { success: false, message }
        }
    }
}
