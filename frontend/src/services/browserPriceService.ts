import { debugLog } from '../utils/debug'
import { API_CONFIG } from '../config/api'
import { unwrapPriceFeedPayload } from '../hooks/queries/usePricesQuery'

export interface BrowserPriceRow {
    price: number
    change?: number
    timestamp: number
    source: string
    volume?: number
    servedFromCache?: boolean
    serverFetchedAtMs?: number
    cacheAgeMs?: number
    quoteAgeSeconds?: number
    dataTier?: 'primary' | 'cached_primary' | 'stale_cached' | 'synthetic_fallback'
}

export type BrowserPricesMap = Record<string, BrowserPriceRow>

export interface BrowserPriceFeedMeta {
    provider: 'browser'
    resolvedAtMs: number
    degraded: boolean
    staleOrLimited: boolean
    resolutionHint: 'fresh_primary' | 'cached_only' | 'error_recovery_cache' | 'synthetic_fallback'
    assetsCount: number
}

export interface BrowserPricesPayload {
    prices: BrowserPricesMap
    feedMeta: BrowserPriceFeedMeta
}

class BrowserPriceService {
    private cache: Map<string, { data: BrowserPricesMap; timestamp: number }> = new Map()
    private readonly CACHE_DURATION = 60000
    private readonly REQUEST_TIMEOUT = 10000

    private readonly COIN_IDS = {
        XLM: 'stellar',
        BTC: 'bitcoin',
        ETH: 'ethereum',
        USDC: 'usd-coin'
    }

    private finalizeRows(map: BrowserPricesMap): BrowserPricesMap {
        const nowSec = Math.floor(Date.now() / 1000)
        const out: BrowserPricesMap = {}
        for (const [asset, row] of Object.entries(map)) {
            const tsSec = row.timestamp < 1e12 ? Math.floor(row.timestamp) : Math.floor(row.timestamp / 1000)
            out[asset] = {
                ...row,
                quoteAgeSeconds: Math.max(0, nowSec - tsSec),
                cacheAgeMs:
                    row.servedFromCache && row.serverFetchedAtMs !== undefined
                        ? Math.max(0, Date.now() - row.serverFetchedAtMs)
                        : row.cacheAgeMs
            }
        }
        return out
    }

    private buildMeta(
        prices: BrowserPricesMap,
        hint: BrowserPriceFeedMeta['resolutionHint']
    ): BrowserPriceFeedMeta {
        const entries = Object.values(prices)
        const degraded =
            hint === 'synthetic_fallback' ||
            entries.some((p) => p.dataTier === 'synthetic_fallback' || p.source === 'fallback_browser')
        const staleOrLimited = hint === 'error_recovery_cache'
        return {
            provider: 'browser',
            resolvedAtMs: Date.now(),
            degraded,
            staleOrLimited,
            resolutionHint: hint,
            assetsCount: Object.keys(prices).length
        }
    }

    async getCurrentPrices(): Promise<BrowserPricesPayload> {
        try {
            const cached = this.cache.get('prices')
            if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
                const withServe = this.applyCachedServeFlags(cached.data, cached.timestamp)
                const finalized = this.finalizeRows(withServe)
                return {
                    prices: finalized,
                    feedMeta: this.buildMeta(finalized, 'cached_only')
                }
            }

            // Attempt 1: Primary Source (Reflector via Backend)
            try {
                debugLog('Fetching prices from primary source (Reflector via Backend)')
                const reflectorUrl = `${API_CONFIG.BASE_URL.replace(/\/$/, '')}${API_CONFIG.ENDPOINTS.PRICES}`
                const reflectorResponse = await fetch(reflectorUrl, {
                    method: 'GET',
                    headers: { Accept: 'application/json' },
                    signal: AbortSignal.timeout(5000)
                })

                if (reflectorResponse.ok) {
                    const raw = await reflectorResponse.json()
                    const { prices: row } = unwrapPriceFeedPayload(raw)
                    if (Object.keys(row).length > 0) {
                        const prices: BrowserPricesMap = {}
                        const fetchedAt = Date.now()
                        Object.entries(row).forEach(([asset, data]: [string, any]) => {
                            prices[asset] = {
                                price: data.price,
                                change: data.change || 0,
                                timestamp: data.timestamp || Math.floor(Date.now() / 1000),
                                source: 'reflector',
                                servedFromCache: false,
                                serverFetchedAtMs: fetchedAt,
                                dataTier: 'primary'
                            }
                        })

                        this.cache.set('prices', { data: prices, timestamp: fetchedAt })
                        const finalized = this.finalizeRows(prices)
                        return {
                            prices: finalized,
                            feedMeta: this.buildMeta(finalized, 'fresh_primary')
                        }
                    }
                }
            } catch (reflectorError) {
                debugLog('Reflector fetch failed, falling back to CoinGecko', reflectorError)
            }

            // Attempt 2: Fallback to CoinGecko
            debugLog('Fetching fresh prices from CoinGecko (browser)')

            const coinIds = Object.values(this.COIN_IDS).join(',')
            const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`

            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT)

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    Accept: 'application/json'
                },
                signal: controller.signal
            })

            clearTimeout(timeoutId)

            if (!response.ok) {
                throw new Error(`CoinGecko API error: ${response.status}`)
            }

            const data = await response.json()
            debugLog('CoinGecko browser response', {
                assets: Object.keys(data as Record<string, unknown>)
            })

            const prices: BrowserPricesMap = {}
            const fetchedAt = Date.now()

            Object.entries(this.COIN_IDS).forEach(([asset, coinId]) => {
                const coinData = data[coinId]
                if (coinData && coinData.usd !== undefined) {
                    prices[asset] = {
                        price: coinData.usd,
                        change: coinData.usd_24h_change || 0,
                        timestamp: coinData.last_updated_at || Math.floor(Date.now() / 1000),
                        source: 'coingecko_browser',
                        volume: coinData.usd_24h_vol || 0,
                        servedFromCache: false,
                        serverFetchedAtMs: fetchedAt,
                        dataTier: 'primary'
                    }
                }
            })

            if (Object.keys(prices).length === 0) {
                throw new Error('No price data received from CoinGecko')
            }

            this.cache.set('prices', {
                data: prices,
                timestamp: Date.now()
            })

            const finalized = this.finalizeRows(prices)
            return {
                prices: finalized,
                feedMeta: this.buildMeta(finalized, 'fresh_primary')
            }
        } catch (error) {
            console.error('Browser price fetch failed:', error)

            const cached = this.cache.get('prices')
            if (cached) {
                debugLog('Using stale cached data due to error')
                const withServe = this.applyStaleServeFlags(cached.data, cached.timestamp)
                const finalized = this.finalizeRows(withServe)
                return {
                    prices: finalized,
                    feedMeta: this.buildMeta(finalized, 'error_recovery_cache')
                }
            }

            const fallback = this.getFallbackPrices()
            const finalized = this.finalizeRows(fallback)
            return {
                prices: finalized,
                feedMeta: this.buildMeta(finalized, 'synthetic_fallback')
            }
        }
    }

    private applyCachedServeFlags(map: BrowserPricesMap, cacheBucketMs: number): BrowserPricesMap {
        const out: BrowserPricesMap = {}
        const now = Date.now()
        for (const [k, v] of Object.entries(map)) {
            const base = { ...v }
            delete base.servedFromCache
            delete base.serverFetchedAtMs
            delete base.cacheAgeMs
            delete base.quoteAgeSeconds
            delete base.dataTier
            out[k] = {
                ...base,
                servedFromCache: true,
                serverFetchedAtMs: cacheBucketMs,
                cacheAgeMs: now - cacheBucketMs,
                dataTier: base.source === 'fallback_browser' ? 'synthetic_fallback' : 'cached_primary'
            }
        }
        return out
    }

    private applyStaleServeFlags(map: BrowserPricesMap, cacheBucketMs: number): BrowserPricesMap {
        const out: BrowserPricesMap = {}
        const now = Date.now()
        for (const [k, v] of Object.entries(map)) {
            const base = { ...v }
            delete base.servedFromCache
            delete base.serverFetchedAtMs
            delete base.cacheAgeMs
            delete base.quoteAgeSeconds
            delete base.dataTier
            out[k] = {
                ...base,
                servedFromCache: true,
                serverFetchedAtMs: cacheBucketMs,
                cacheAgeMs: now - cacheBucketMs,
                dataTier: 'stale_cached'
            }
        }
        return out
    }

    private getFallbackPrices(): BrowserPricesMap {
        debugLog('Using fallback prices in browser service')

        const now = Math.floor(Date.now() / 1000)
        const addVariation = (basePrice: number) => {
            const variation = (Math.random() - 0.5) * 0.02
            return basePrice * (1 + variation)
        }
        const fetchedAt = Date.now()

        return {
            XLM: {
                price: addVariation(0.354),
                change: (Math.random() - 0.5) * 4,
                timestamp: now,
                source: 'fallback_browser',
                servedFromCache: false,
                serverFetchedAtMs: fetchedAt,
                dataTier: 'synthetic_fallback'
            },
            USDC: {
                price: addVariation(1.0),
                change: (Math.random() - 0.5) * 0.1,
                timestamp: now,
                source: 'fallback_browser',
                servedFromCache: false,
                serverFetchedAtMs: fetchedAt,
                dataTier: 'synthetic_fallback'
            },
            BTC: {
                price: addVariation(110000),
                change: (Math.random() - 0.5) * 6,
                timestamp: now,
                source: 'fallback_browser',
                servedFromCache: false,
                serverFetchedAtMs: fetchedAt,
                dataTier: 'synthetic_fallback'
            },
            ETH: {
                price: addVariation(4200),
                change: (Math.random() - 0.5) * 5,
                timestamp: now,
                source: 'fallback_browser',
                servedFromCache: false,
                serverFetchedAtMs: fetchedAt,
                dataTier: 'synthetic_fallback'
            }
        }
    }

    clearCache(): void {
        this.cache.clear()
        debugLog('Browser price cache cleared')
    }

    async testConnection(): Promise<{ success: boolean; error?: string }> {
        try {
            const response = await fetch(
                'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
                { method: 'GET', signal: AbortSignal.timeout(5000) }
            )

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`)
            }

            await response.json()
            return { success: true }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            }
        }
    }
}

export const browserPriceService = new BrowserPriceService()
export default browserPriceService
