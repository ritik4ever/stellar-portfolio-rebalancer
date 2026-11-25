import type { PricesMap, PriceData, PriceFeedMeta, PricesFeedPayload } from '../types/index.js'
import { getFeatureFlags } from '../config/featureFlags.js'
import { logger } from '../utils/logger.js'
import { recordCacheTtl, recordPriceFeedResolution, recordReflectorFallbackUsage, recordReflectorStalePrice, recordCacheOperation, recordCacheExpiration, recordCacheAge, recordCacheHitRatio, recordCacheSize, recordCacheEntries } from '../observability/metrics.js'
import { assetRegistryService } from './assetRegistryService.js'
import { CoinGeckoFallbackCache, readCoinGeckoFallbackTtlMs } from './coinGeckoFallbackCache.js'
import { REDIS_URL } from '../queue/connection.js'
import { databaseService } from './databaseService.js'
import type { PriceIngestionDecision, PriceIngestionReasonCode } from './priceIngestionBoundary.js'
import { normalizeScaledQuote } from '../utils/quotePrecision.js'


type PriceResolutionHint = PriceFeedMeta['resolutionHint']

/**
 * Outcome of a Reflector oracle reachability probe.
 *
 * `reason` distinguishes the failure modes that need different operator action:
 *   not_configured — REFLECTOR_API_URL is unset (fallback price source only)
 *   unreachable    — DNS/TCP/TLS failure reaching the oracle
 *   timeout        — oracle accepted the connection but did not answer in time
 *   http_error     — oracle answered with a non-2xx status
 *   no_data        — oracle answered but returned no price for the probed asset
 *   stale          — oracle answered with a quote older than PRICE_DATA_MAX_AGE
 *   ok             — fresh quote returned
 */
export type OracleReachabilityReason =
    | 'ok'
    | 'not_configured'
    | 'unreachable'
    | 'timeout'
    | 'http_error'
    | 'no_data'
    | 'stale'

export interface OracleReachabilityResult {
    reachable: boolean
    reason: OracleReachabilityReason
    asset: string
    endpoint?: string
    latencyMs?: number
    httpStatus?: number
    quoteTimestamp?: number
    error?: string
}

type PriceIngestionLogOutcome = 'success' | 'delayed' | 'blocked'

type PriceIngestionLogReasonCode =
    | PriceIngestionReasonCode
    | 'MISSING_QUOTE'
    | 'INVALID_QUOTE'
    | 'PERSISTENCE_FAILED'

const ORACLE_DEVIATION_TOLERANCE_BPS = 300
const REFLECTOR_TIMEOUT_MS = 5000

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
    private pendingResolution?: ReturnType<ReflectorService['resolvePricesWithRedisCache']>
    private readonly MIN_REQUEST_INTERVAL = 90000 // Increased to 1.5 minutes for Pro API
    private readonly oracleCacheTtlSeconds: number

    // Cache metrics tracking
    private cacheStats: Map<string, { hits: number; misses: number; lastAgeMs: number }> = new Map()
    private cacheMetricsReportInterval: NodeJS.Timer | null = null
    private redisCache: Awaited<ReturnType<typeof import('ioredis').default>> | null = null
    private redisAvailable: boolean = false
    private readonly ORACLE_CACHE_KEY = 'oracle:prices'
    private readonly coinGeckoFallbackCache: CoinGeckoFallbackCache<PriceData>

    constructor() {
        this.coinGeckoApiKey = process.env.COINGECKO_API_KEY || ''
        this.priceCache = new Map()
        this.coinGeckoIds = { ...DEFAULT_COIN_IDS }
        this.reflectorApiUrl = process.env.REFLECTOR_API_URL || ''

        const rawTtl = Number.parseInt(process.env.ORACLE_CACHE_TTL_SECONDS || '30', 10)
        this.oracleCacheTtlSeconds = Number.isFinite(rawTtl) && rawTtl >= 0 ? rawTtl : 30
        this.coinGeckoFallbackCache = new CoinGeckoFallbackCache(readCoinGeckoFallbackTtlMs())

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

    /** CoinGecko / Reflector API base URL (supports REFLECTOR_SERVICE_URL for offline dev) */
    private getBaseUrl(): string {
        const customUrl = process.env.REFLECTOR_SERVICE_URL || process.env.COINGECKO_BASE_URL
        if (customUrl && customUrl.trim()) {
            return customUrl.trim().replace(/\/$/, '')
        }
        const apiKey = this.coinGeckoApiKey
        return apiKey && apiKey.trim()
            ? 'https://pro-api.coingecko.com/api/v3'
            : 'https://api.coingecko.com/api/v3'
    }

    async getCurrentPrices(): Promise<PricesMap> {
        const { map } = await this.resolvePrices()
        return this.applyQuoteAges(map)
    }

    async getCurrentPricesWithMeta(): Promise<PricesFeedPayload> {
        const { map, hint, cacheStatus } = await this.resolvePrices()
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
            || (hint === 'partial_merge' && this.getAssetList().some(asset => prices[asset] === undefined))
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
                commandTimeout: 2000,
                enableOfflineQueue: false,
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
                const matchesAccepted = Object.entries(map).every(([asset, quote]) => {
                    if (quote.source !== 'reflector') return true
                    const accepted = databaseService.getAcceptedReflectorQuote(asset)
                    return accepted?.source === quote.source && accepted.price === quote.price
                        && accepted.ledger === quote.ledger && accepted.timestamp === quote.timestamp
                })
                if (matchesAccepted) return { map, cacheStatus: 'redis_hit' }
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
                    volume: data.volume,
                    ledger: data.ledger
                }
            }
            await redis.set(this.ORACLE_CACHE_KEY, JSON.stringify(stripped), 'EX', this.oracleCacheTtlSeconds)
        } catch {
            // Redis write failed — graceful degradation
        }
    }

    private async resolvePrices() {
        if (this.pendingResolution) {
            logger.info('[ORACLE] quote_precision', { source: 'price_feed', outcome: 'delayed', reason: 'in_flight' })
            return this.pendingResolution
        }

        this.pendingResolution = this.resolvePricesWithRedisCache()
        try {
            return await this.pendingResolution
        } finally {
            this.pendingResolution = undefined
        }
    }

    private async resolvePricesWithRedisCache(): Promise<{ map: PricesMap; hint: PriceResolutionHint; cacheStatus: PriceFeedMeta['cacheStatus'] }> {
        if (this.oracleCacheTtlSeconds === 0) {
            const result = await this.resolvePricesInternal()
            return { ...result, cacheStatus: 'redis_bypassed' }
        }

        const redisResult = await this.readFromRedisCache()
        if (redisResult?.cacheStatus === 'redis_hit' && Object.keys(redisResult.map).length > 0) {
            const incomplete = this.getAssetList().some(asset => redisResult.map[asset] === undefined)
            return { map: redisResult.map, hint: incomplete ? 'partial_merge' : 'cached_only', cacheStatus: 'redis_hit' }
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
                this.logCoinGeckoFallback('delayed', 'local_rate_limit', { assets })
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
            const staleReflectorPrices = new Map<string, number>()
            const reflectorTimeout = AbortSignal.timeout(REFLECTOR_TIMEOUT_MS)
            try {
                reflectorPrices = await this.getReflectorPrices(assets, staleReflectorPrices, reflectorTimeout)
            } catch {
                if (reflectorTimeout.aborted) {
                    logger.warn('[ORACLE] quote_precision', { source: 'reflector', outcome: 'delayed', reason: 'timeout', assets })
                } else {
                    logger.warn('[WARNING] Reflector fetch failed, falling back to CoinGecko')
                }
            }

            const missingAssets = assets.filter((asset) => reflectorPrices[asset] === undefined)
            let freshPrices: PricesMap = {}
            if (missingAssets.length > 0) {
                try {
                    freshPrices = await this.getFreshPrices(missingAssets, this.getCoinIdMap(), staleReflectorPrices)
                } catch (error) {
                    if (Object.keys(reflectorPrices).length === 0) throw error
                }
            }

            const merged = { ...cachedPrices, ...reflectorPrices, ...freshPrices } as PricesMap
            if (Object.keys(merged).length === 0) {
                throw new Error('No valid price data available from Reflector or CoinGecko')
            }

            const hint: PriceResolutionHint =
                Object.keys(reflectorPrices).length + Object.keys(freshPrices).length === assets.length
                    ? 'fresh_primary'
                    : 'partial_merge'
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

    private isPriceStale(timestamp: number): boolean {
        const tsSec = timestamp >= 1e12 ? Math.floor(timestamp / 1000) : Math.floor(timestamp)
        const nowSec = Math.floor(Date.now() / 1000)
        return (nowSec - tsSec) > this.PRICE_DATA_MAX_AGE
    }

    private quoteAgeSeconds(timestamp: number): number {
        const tsSec = timestamp >= 1e12 ? Math.floor(timestamp / 1000) : Math.floor(timestamp)
        return Math.max(0, Math.floor(Date.now() / 1000) - tsSec)
    }

    /**
     * Single structured signal for every per-asset Reflector ingestion outcome.
     * `success`/`delayed`/`blocked` let operators tell accepted work apart from
     * quotes the oracle has not published yet (stale) and quotes refused by the
     * ingestion boundary (older ledger, invalid quote, persistence failure).
     * Context is limited to identifiers, ledger numbers and measurements —
     * never URLs, credentials or raw provider payloads.
     */
    private logPriceIngestion(fields: {
        asset: string
        outcome: PriceIngestionLogOutcome
        reasonCode?: PriceIngestionLogReasonCode
        observedLedger?: number
        observedPrice?: number
        acceptedLedger?: number
        acceptedPrice?: number
        acceptedSource?: string
        ageMs?: number
        quoteAgeSeconds?: number
        decimals?: number
        units?: string
    }): void {
        const payload = { source: 'reflector' as const, ...fields }
        if (fields.outcome === 'success') {
            logger.info('[ORACLE] price_ingestion', payload)
        } else {
            logger.warn('[ORACLE] price_ingestion', payload)
        }
    }

    private async getReflectorPrices(
        assets: string[], stalePrices: Map<string, number>, signal: AbortSignal
    ): Promise<PricesMap> {
        if (!this.reflectorApiUrl) return {}

        const url = `${this.reflectorApiUrl.replace(/\/$/, '')}/prices?assets=${encodeURIComponent(assets.join(','))}`
        const response = await fetch(url, {
            method: 'GET',
            signal,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'StellarPortfolioRebalancer/1.0'
            }
        })

        if (!response.ok) {
            throw new Error(`Reflector API error: ${response.status}`)
        }

        type ReflectorRow = { price: string | number | bigint; timestamp: number; decimals?: number; change?: number; volume?: number; ledger?: number }
        const payload = await response.json() as { prices?: Record<string, ReflectorRow> } | Record<string, ReflectorRow>
        signal.throwIfAborted()
        const rows = (('prices' in payload && payload.prices) ? payload.prices : payload) as Record<string, ReflectorRow>

        const out: PricesMap = {}
        let staleCount = 0
        const nowMs = Date.now()

        assets.forEach((asset) => {
            const row = rows?.[asset]
            if (!row) {
                this.logPriceIngestion({
                    asset,
                    outcome: 'blocked',
                    reasonCode: 'MISSING_QUOTE'
                })
                return
            }

            const decimals = row.decimals ?? 0
            const context = { source: 'reflector', asset, decimals: Number.isInteger(decimals) ? decimals : undefined }
            let normalized: ReturnType<typeof normalizeScaledQuote>
            try {
                normalized = normalizeScaledQuote(row.price, decimals)
            } catch (error) {
                logger.warn('[ORACLE] quote_precision', {
                    ...context, outcome: 'blocked', reason: error instanceof RangeError ? 'integer_overflow' : 'invalid_quote'
                })
                this.logPriceIngestion({
                    asset,
                    outcome: 'blocked',
                    reasonCode: 'INVALID_QUOTE',
                    observedLedger: row.ledger,
                    decimals: Number.isInteger(decimals) ? decimals : undefined
                })
                return
            }
            const price = normalized.price

            let decision: PriceIngestionDecision
            try {
                decision = databaseService.acceptReflectorQuote({
                    asset,
                    source: 'reflector',
                    price,
                    timestamp: row.timestamp,
                    ledger: row.ledger,
                    maxAgeSeconds: this.PRICE_DATA_MAX_AGE,
                    nowMs
                })
            } catch {
                this.logPriceIngestion({
                    asset,
                    outcome: 'blocked',
                    reasonCode: 'PERSISTENCE_FAILED',
                    observedLedger: row.ledger
                })
                return
            }
            if (decision.result === 'rejected') {
                if (decision.reasonCode === 'STALE_QUOTE') {
                    staleCount += 1
                    recordReflectorStalePrice(asset)
                    stalePrices.set(asset, price)
                    this.logPriceIngestion({
                        asset,
                        outcome: 'delayed',
                        reasonCode: decision.reasonCode,
                        observedLedger: decision.observedLedger,
                        acceptedLedger: decision.acceptedLedger,
                        acceptedPrice: decision.acceptedPrice,
                        acceptedSource: decision.acceptedSource,
                        ageMs: decision.ageMs,
                        quoteAgeSeconds: this.quoteAgeSeconds(row.timestamp),
                        decimals: normalized.decimals,
                        units: normalized.units
                    })
                    return
                }

                this.logPriceIngestion({
                    asset,
                    outcome: 'blocked',
                    reasonCode: decision.reasonCode,
                    observedLedger: decision.observedLedger,
                    observedPrice: decision.observedPrice,
                    acceptedLedger: decision.acceptedLedger,
                    acceptedPrice: decision.acceptedPrice,
                    acceptedSource: decision.acceptedSource,
                    ageMs: decision.ageMs
                })
                return
            }

            this.logPriceIngestion({
                asset,
                outcome: 'success',
                reasonCode: decision.reasonCode,
                observedLedger: decision.observedLedger,
                acceptedLedger: decision.acceptedLedger,
                acceptedPrice: decision.acceptedPrice,
                ageMs: decision.ageMs,
                decimals: normalized.decimals,
                units: normalized.units
            })
            logger.info('[ORACLE] quote_precision', {
                ...context, outcome: 'success', reason: 'normalized',
                units: normalized.units, decimals: normalized.decimals
            })

            out[asset] = {
                price,
                change: row.change ?? 0,
                timestamp: row.timestamp,
                source: 'reflector',
                volume: row.volume,
                servedFromCache: false,
                serverFetchedAtMs: nowMs,
                dataTier: 'primary',
                ledger: decision.acceptedLedger
            }
        })

        if (Object.keys(out).length === 0 && staleCount > 0) {
            throw new Error('Reflector data is stale')
        }

        return out
    }

    private logCoinGeckoFallback(
        outcome: 'success' | 'delayed' | 'blocked',
        reason: string,
        context: { assets?: string[]; asset?: string; httpStatus?: number; deviationBps?: number; toleranceBps?: number }
    ): void {
        const source = this.coinGeckoApiKey ? 'coingecko_pro' : 'coingecko_free'
        const fields = { source, outcome, reason, ...context }
        if (outcome === 'success' && reason !== 'price_disagreement') {
            logger.info('[ORACLE] coingecko_fallback', fields)
        } else {
            logger.warn('[ORACLE] coingecko_fallback', fields)
        }
    }

    private async getFreshPrices(
        assets: string[], coinIds: Record<string, string>, staleReflectorPrices: Map<string, number>
    ): Promise<PricesMap> {
        // Returns the deviation in bps when a stale Reflector reference exists;
        // undefined means the quote may be served.
        const logQuote = (asset: string, price: number, reason: 'cache_hit'): number | undefined => {
            const reference = staleReflectorPrices.get(asset)
            if (reference === undefined) {
                this.logCoinGeckoFallback('success', reason, { asset })
                return undefined
            }
            const deviation = (Math.abs(reference - price) / Math.max(reference, price)) * 10_000
            const deviationBps = Number(deviation.toFixed(9))
            if (deviationBps > ORACLE_DEVIATION_TOLERANCE_BPS) {
                this.logCoinGeckoFallback('blocked', 'price_disagreement', {
                    asset, deviationBps, toleranceBps: ORACLE_DEVIATION_TOLERANCE_BPS
                })
                return deviationBps
            }
            this.logCoinGeckoFallback('success', reason, { asset })
            return undefined
        }

        const now = Date.now()
        const cachedFallback = this.coinGeckoFallbackCache.getAll(assets, now)
        if (cachedFallback) {
            // Re-validate cached quotes against the latest Reflector reference;
            // a disagreeing entry is dropped rather than served.
            const accepted: PricesMap = {}
            assets.forEach(asset => {
                const deviationBps = logQuote(asset, cachedFallback[asset].price, 'cache_hit')
                if (deviationBps === undefined) {
                    accepted[asset] = cachedFallback[asset]
                }
            })
            return accepted
        }

        if (now - this.lastRequestTime < this.MIN_REQUEST_INTERVAL) {
            this.logCoinGeckoFallback('delayed', 'local_rate_limit', { assets })
            return {}
        }

        this.lastRequestTime = now
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 15000)
        let httpStatus: number | undefined
        let failureReason = 'request_failed'

        try {
            const params = new URLSearchParams({
                ids: assets.map(asset => coinIds[asset]).filter(Boolean).join(','),
                vs_currencies: 'usd',
                include_24hr_change: 'true',
                include_last_updated_at: 'true'
            })
            const response = await fetch(`${this.getBaseUrl()}/simple/price?${params.toString()}`, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'StellarPortfolioRebalancer/1.0'
                },
                method: 'GET',
                signal: controller.signal
            })
            httpStatus = response.status
            if (!response.ok) {
                failureReason = httpStatus === 429 ? 'provider_rate_limit' : 'http_error'
                throw new Error('CoinGecko request failed')
            }

            failureReason = 'invalid_response'
            const data = await response.json()
            const prices: PricesMap = {}

            assets.forEach(asset => {
                const coinData = data?.[coinIds[asset]]
                if (typeof coinData?.usd !== 'number' || !Number.isFinite(coinData.usd) || coinData.usd <= 0) {
                    this.logCoinGeckoFallback('blocked', 'no_valid_quote', { asset })
                    return
                }

                const priceData: PriceData = {
                    price: coinData.usd,
                    change: coinData.usd_24h_change || 0,
                    timestamp: coinData.last_updated_at || Math.floor(Date.now() / 1000),
                    source: this.coinGeckoApiKey ? 'coingecko_pro' : 'coingecko_free',
                    volume: coinData.usd_24h_vol || 0,
                    servedFromCache: false,
                    serverFetchedAtMs: Date.now(),
                    dataTier: 'primary'
                }

                // Explicit stop: a fallback quote that disagrees with the last
                // Reflector reference beyond tolerance is never served or cached,
                // so a later retry re-evaluates it instead of duplicating side effects.
                const reference = staleReflectorPrices.get(asset)
                if (reference !== undefined) {
                    const deviationBps = Number(((Math.abs(reference - priceData.price) / Math.max(reference, priceData.price)) * 10_000).toFixed(9))
                    if (deviationBps > ORACLE_DEVIATION_TOLERANCE_BPS) {
                        this.logCoinGeckoFallback('blocked', 'price_disagreement', {
                            asset, deviationBps, toleranceBps: ORACLE_DEVIATION_TOLERANCE_BPS
                        })
                        return
                    }
                }

                // Persist freshness before the quote becomes visible so an
                // interrupted write cannot leave caches serving an unrecorded price.
                try {
                    databaseService.setAssetFreshness(asset, new Date().toISOString(), false)
                } catch {
                    this.logCoinGeckoFallback('blocked', 'freshness_persist_failed', { asset })
                    logger.error('[ASSET-REGISTRY] Failed to update freshness during CoinGecko fetch', { asset })
                    return
                }

                prices[asset] = priceData
                const cachedAtMs = Date.now()
                this.priceCache.set(asset, {
                    data: {
                        price: priceData.price,
                        change: priceData.change,
                        timestamp: priceData.timestamp,
                        source: priceData.source,
                        volume: priceData.volume
                    },
                    cachedAtMs
                })
                this.coinGeckoFallbackCache.put(asset, { ...priceData, servedFromCache: true }, cachedAtMs)
                recordCacheOperation('update', asset)
                this.logCoinGeckoFallback('success', 'fetched', { asset })
            })

            if (Object.keys(prices).length === 0) {
                throw new Error('No valid price data received from CoinGecko')
            }
            return prices
        } catch {
            const reason = controller.signal.aborted ? 'timeout' : failureReason
            const outcome = reason === 'timeout' || reason === 'provider_rate_limit' ? 'delayed' : 'blocked'
            this.logCoinGeckoFallback(outcome, reason, { assets, httpStatus })
            throw new Error(`CoinGecko fallback failed: ${reason}`)
        } finally {
            clearTimeout(timeoutId)
        }
    }

    async getDetailedMarketData(asset: string): Promise<any> {
        try {
            const coinIds = this.getCoinIdMap()
            const coinId = coinIds[asset]
            if (!coinId) throw new Error(`Unsupported asset: ${asset}`)

            const apiKey = this.coinGeckoApiKey
            const baseUrl = this.getBaseUrl()

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
            return await this.getMarketPriceHistory(asset, days)
        } catch (error) {
            logger.error('Failed to get price history for asset', { asset, error })
            if (!getFeatureFlags().allowMockPriceHistory) {
                throw new Error(`Price history unavailable for ${asset} and ALLOW_MOCK_PRICE_HISTORY is disabled`)
            }
            return this.generateMockHistory(asset, days * 24)
        }
    }

    /**
     * Real historical prices from CoinGecko `market_chart`. Never falls back to
     * synthetic data — callers that must not show mock prices (e.g. backtests)
     * use this instead of getPriceHistory.
     */
    async getMarketPriceHistory(asset: string, days: number = 7): Promise<Array<{ timestamp: number, price: number }>> {
        const coinIds = this.getCoinIdMap()
        const coinId = coinIds[asset]
        if (!coinId) throw new Error(`Unsupported asset: ${asset}`)

        const apiKey = this.coinGeckoApiKey
        const baseUrl = this.getBaseUrl()

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

        try {
            const response = await fetch(
                `${baseUrl}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=${interval}`,
                {
                    headers,
                    signal: controller.signal
                }
            )

            if (!response.ok) {
                throw new Error(`CoinGecko history API error: ${response.status}`)
            }

            const data = await response.json()

            return data.prices.map(([timestamp, price]: [number, number]) => ({
                timestamp: Math.floor(timestamp / 1000),
                price
            }))
        } finally {
            clearTimeout(timeoutId)
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

    /**
     * Lightweight, read-only reachability probe for the Reflector oracle itself
     * (distinct from testApiConnectivity, which exercises the CoinGecko fallback).
     *
     * Fetches a single asset price and reports a machine-readable `reason` so
     * callers — the startup self-test in particular — can tell an unconfigured
     * oracle from an unreachable one, an HTTP error, or a stale feed.
     */
    async testOracleReachability(
        options: { timeoutMs?: number; asset?: string } = {},
    ): Promise<OracleReachabilityResult> {
        const timeoutMs = options.timeoutMs ?? REFLECTOR_TIMEOUT_MS
        const asset = options.asset || this.getAssetList()[0] || DEFAULT_SYMBOLS[0]
        const endpoint = this.reflectorApiUrl.replace(/\/$/, '')

        if (!endpoint) {
            return {
                reachable: false,
                reason: 'not_configured',
                asset,
                error: 'REFLECTOR_API_URL is not set',
            }
        }

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
        const startedAt = Date.now()

        try {
            const response = await fetch(
                `${endpoint}/prices?assets=${encodeURIComponent(asset)}`,
                {
                    method: 'GET',
                    headers: {
                        Accept: 'application/json',
                        'User-Agent': 'StellarPortfolioRebalancer/1.0',
                    },
                    signal: controller.signal,
                },
            )

            const latencyMs = Date.now() - startedAt

            if (!response.ok) {
                return {
                    reachable: false,
                    reason: 'http_error',
                    asset,
                    endpoint,
                    latencyMs,
                    httpStatus: response.status,
                    error: `Reflector API responded ${response.status}`,
                }
            }

            const payload = await response.json() as
                | { prices?: Record<string, { price?: unknown; timestamp?: number }> }
                | Record<string, { price?: unknown; timestamp?: number }>
            const rows = ('prices' in payload && payload.prices) ? payload.prices : payload
            const row = (rows as Record<string, { price?: unknown; timestamp?: number }>)?.[asset]

            if (!row || row.price === undefined || row.price === null) {
                return {
                    reachable: false,
                    reason: 'no_data',
                    asset,
                    endpoint,
                    latencyMs,
                    httpStatus: response.status,
                    error: `Reflector returned no price for ${asset}`,
                }
            }

            if (typeof row.timestamp === 'number' && this.isPriceStale(row.timestamp)) {
                return {
                    reachable: true,
                    reason: 'stale',
                    asset,
                    endpoint,
                    latencyMs,
                    httpStatus: response.status,
                    quoteTimestamp: row.timestamp,
                    error: `Reflector price for ${asset} is older than ${this.PRICE_DATA_MAX_AGE}s`,
                }
            }

            return {
                reachable: true,
                reason: 'ok',
                asset,
                endpoint,
                latencyMs,
                httpStatus: response.status,
                quoteTimestamp: row.timestamp,
            }
        } catch (error) {
            const aborted = error instanceof Error && error.name === 'AbortError'
            return {
                reachable: false,
                reason: aborted ? 'timeout' : 'unreachable',
                asset,
                endpoint,
                latencyMs: Date.now() - startedAt,
                error: aborted
                    ? `Reflector oracle did not respond within ${timeoutMs}ms`
                    : error instanceof Error ? error.message : String(error),
            }
        } finally {
            clearTimeout(timeoutId)
        }
    }

    async testApiConnectivity(): Promise<{ success: boolean, error?: string, data?: any }> {
        try {
            const apiKey = this.coinGeckoApiKey
            const baseUrl = this.getBaseUrl()

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
        this.coinGeckoFallbackCache.clear()
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
