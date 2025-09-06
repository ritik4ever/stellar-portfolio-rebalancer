import { SorobanRpc } from '@stellar/stellar-sdk'
import type { PricesMap, PriceData } from '../types/index.ts'

export class ReflectorService {
    private coinGeckoApiKey: string
    private coinGeckoIds: Record<string, string>
    private priceCache: Map<string, { data: PriceData, timestamp: number }>
    private readonly CACHE_DURATION = 120000 // 2 minutes
    private readonly MIN_REQUEST_INTERVAL = 10000 // 10 sconds between requests

    constructor() {
        this.coinGeckoApiKey = process.env.COINGECKO_API_KEY || ''
        this.priceCache = new Map()

        // CoinGecko ID mapping
        this.coinGeckoIds = {
            'XLM': 'stellar',
            'BTC': 'bitcoin',
            'ETH': 'ethereum',
            'USDC': 'usd-coin'
        }
    }

    async getCurrentPrices(): Promise<PricesMap> {
        try {
            console.log('Fetching prices from CoinGecko with smart caching')
            const assets = ['XLM', 'BTC', 'ETH', 'USDC']

            // Check if we have fresh cached data for all assets
            const cachedPrices = this.getCachedPrices(assets)
            if (Object.keys(cachedPrices).length === assets.length) {
                console.log('Using cached prices for all assets')
                return cachedPrices
            }

            // Get fresh data only if cache is stale
            const freshPrices = await this.getFreshPrices(assets)

            // Merge cached and fresh data
            return { ...cachedPrices, ...freshPrices }
        } catch (error) {
            console.error('Price fetch failed:', error)
            return this.getFallbackPrices()
        }
    }

    private getCachedPrices(assets: string[]): PricesMap {
        const cachedPrices: PricesMap = {}
        const now = Date.now()

        assets.forEach(asset => {
            const cached = this.priceCache.get(asset)
            if (cached && (now - cached.timestamp) < this.CACHE_DURATION) {
                cachedPrices[asset] = cached.data
            }
        })

        return cachedPrices
    }

    private async getFreshPrices(assets: string[]): Promise<PricesMap> {
        const now = Date.now()

        // Rate limiting - don't make requests too frequently
        if (now - this.lastRequestTime < this.MIN_REQUEST_INTERVAL) {
            console.log('Rate limiting - using cached prices')
            return {}
        }

        this.lastRequestTime = now

        try {
            const apiKey = this.coinGeckoApiKey
            const baseUrl = apiKey
                ? 'https://pro-api.coingecko.com/api/v3'
                : 'https://api.coingecko.com/api/v3'

            const headers: Record<string, string> = {
                'Accept': 'application/json',
                'User-Agent': 'StellarPortfolioRebalancer/1.0'
            }

            if (apiKey) {
                headers['X-Cg-Pro-Api-Key'] = apiKey
                console.log('Using CoinGecko Pro API')
            } else {
                console.log('Using CoinGecko Free API')
            }

            const coinIds = assets.map(asset => this.coinGeckoIds[asset]).filter(Boolean).join(',')

            const response = await fetch(
                `${baseUrl}/simple/price?ids=${coinIds}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`,
                { headers }
            )

            if (!response.ok) {
                if (response.status === 429) {
                    console.warn('CoinGecko rate limit - using cached data')
                    throw new Error('Rate limit exceeded')
                }
                throw new Error(`CoinGecko API error: ${response.status}`)
            }

            const data = await response.json()
            const prices: PricesMap = {}

            assets.forEach(asset => {
                const coinId = this.coinGeckoIds[asset]
                const coinData = data[coinId]
                if (coinData) {
                    const priceData: PriceData = {
                        price: coinData.usd || 0,
                        change: coinData.usd_24h_change || 0,
                        timestamp: coinData.last_updated_at || Date.now() / 1000,
                        source: apiKey ? 'coingecko_pro' : 'coingecko_free'
                    }

                    prices[asset] = priceData

                    // Cache the fresh data
                    this.priceCache.set(asset, {
                        data: priceData,
                        timestamp: Date.now()
                    })

                    console.log(`Fresh ${asset} price: $${priceData.price} (${priceData.change > 0 ? '+' : ''}${priceData.change.toFixed(2)}%)`)
                }
            })

            return prices
        } catch (error) {
            console.error('Fresh price fetch failed:', error)
            throw error
        }
    }

    async getDetailedMarketData(asset: string): Promise<any> {
        try {
            const coinId = this.coinGeckoIds[asset]
            if (!coinId) throw new Error(`Unsupported asset: ${asset}`)

            // Rate limiting
            await this.rateLimitDelay()

            const apiKey = this.coinGeckoApiKey
            const baseUrl = apiKey
                ? 'https://pro-api.coingecko.com/api/v3'
                : 'https://api.coingecko.com/api/v3'

            const headers: Record<string, string> = {
                'Accept': 'application/json',
                'User-Agent': 'StellarPortfolioRebalancer/1.0'
            }

            if (apiKey) {
                headers['X-Cg-Pro-Api-Key'] = apiKey
            }

            const response = await fetch(
                `${baseUrl}/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`,
                { headers }
            )

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
            console.error(`Failed to get detailed data for ${asset}:`, error)
            throw error
        }
    }

    async getPriceHistory(asset: string, days: number = 7): Promise<Array<{ timestamp: number, price: number }>> {
        try {
            const coinId = this.coinGeckoIds[asset]
            if (!coinId) throw new Error(`Unsupported asset: ${asset}`)

            await this.rateLimitDelay()

            const apiKey = this.coinGeckoApiKey
            const baseUrl = apiKey
                ? 'https://pro-api.coingecko.com/api/v3'
                : 'https://api.coingecko.com/api/v3'

            const headers: Record<string, string> = {
                'Accept': 'application/json',
                'User-Agent': 'StellarPortfolioRebalancer/1.0'
            }

            if (apiKey) {
                headers['X-Cg-Pro-Api-Key'] = apiKey
            }

            let interval = 'daily'
            if (days <= 1) interval = 'minutely'
            else if (days <= 7) interval = 'hourly'

            const response = await fetch(
                `${baseUrl}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=${interval}`,
                { headers }
            )

            if (!response.ok) {
                throw new Error(`CoinGecko history API error: ${response.status}`)
            }

            const data = await response.json()

            return data.prices.map(([timestamp, price]: [number, number]) => ({
                timestamp: Math.floor(timestamp / 1000),
                price
            }))
        } catch (error) {
            console.error(`Failed to get price history for ${asset}:`, error)
            return this.generateMockHistory(asset, days * 24)
        }
    }

    private async rateLimitDelay(): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, 1200)) // 1.2 seconds
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
        console.warn('Using fallback prices - all sources failed')
        return {
            XLM: { price: 0.354, change: 0, timestamp: Date.now() / 1000, source: 'fallback' },
            USDC: { price: 1.0, change: 0, timestamp: Date.now() / 1000, source: 'fallback' },
            BTC: { price: 110000, change: 0, timestamp: Date.now() / 1000, source: 'fallback' },
            ETH: { price: 4200, change: 0, timestamp: Date.now() / 1000, source: 'fallback' }
        }
    }

    // Health check method
    async checkApiHealth(): Promise<{ reflector: boolean, coingecko: boolean }> {
        const health = {
            reflector: false, // Disabled due to contract issues
            coingecko: false
        }

        try {
            await this.rateLimitDelay()
            const testPrices = await this.getFreshPrices(['XLM'])
            health.coingecko = Object.keys(testPrices).length > 0
        } catch (error) {
            console.warn('CoinGecko health check failed')
        }

        return health
    }

    clearCache(): void {
        this.priceCache.clear()
        console.log('Price cache cleared')
    }

    getCacheStatus(): Record<string, any> {
        const status: Record<string, any> = {}
        this.priceCache.forEach((value, key) => {
            status[key] = {
                cached: true,
                age: Date.now() - value.timestamp,
                price: value.data.price,
                source: value.data.source
            }
        })
        return status
    }
}