interface PriceData {
    price: number
    change?: number
    timestamp: number
    source: string
    volume?: number
}

interface PricesMap {
    [asset: string]: PriceData
}

class BrowserPriceService {
    private cache: Map<string, { data: PricesMap, timestamp: number }> = new Map()
    private readonly CACHE_DURATION = 60000 // 1 minute cache
    private readonly REQUEST_TIMEOUT = 10000 // 10 seconds

    private readonly COIN_IDS = {
        'XLM': 'stellar',
        'BTC': 'bitcoin',
        'ETH': 'ethereum',
        'USDC': 'usd-coin'
    }

    async getCurrentPrices(): Promise<PricesMap> {
        try {
            // Check cache first
            const cached = this.cache.get('prices')
            if (cached && (Date.now() - cached.timestamp) < this.CACHE_DURATION) {
                console.log('Using cached prices from browser service')
                return cached.data
            }

            console.log('Fetching fresh prices from CoinGecko (browser)')

            // Build the API URL
            const coinIds = Object.values(this.COIN_IDS).join(',')
            const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`

            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT)

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                },
                signal: controller.signal
            })

            clearTimeout(timeoutId)

            if (!response.ok) {
                throw new Error(`CoinGecko API error: ${response.status}`)
            }

            const data = await response.json()
            console.log('CoinGecko browser response:', data)

            // Transform the data to match your existing format
            const prices: PricesMap = {}

            Object.entries(this.COIN_IDS).forEach(([asset, coinId]) => {
                const coinData = data[coinId]
                if (coinData && coinData.usd !== undefined) {
                    prices[asset] = {
                        price: coinData.usd,
                        change: coinData.usd_24h_change || 0,
                        timestamp: coinData.last_updated_at || Math.floor(Date.now() / 1000),
                        source: 'coingecko_browser',
                        volume: coinData.usd_24h_vol || 0
                    }
                    console.log(`✓ ${asset}: $${coinData.usd} (${coinData.usd_24h_change > 0 ? '+' : ''}${(coinData.usd_24h_change || 0).toFixed(2)}%)`)
                }
            })

            if (Object.keys(prices).length === 0) {
                throw new Error('No price data received from CoinGecko')
            }

            // Cache the results
            this.cache.set('prices', {
                data: prices,
                timestamp: Date.now()
            })

            return prices

        } catch (error) {
            console.error('Browser price fetch failed:', error)

            // Return cached data if available
            const cached = this.cache.get('prices')
            if (cached) {
                console.log('Using stale cached data due to error')
                return cached.data
            }

            // Final fallback
            return this.getFallbackPrices()
        }
    }

    private getFallbackPrices(): PricesMap {
        console.warn('Using fallback prices in browser service')

        const now = Math.floor(Date.now() / 1000)
        const addVariation = (basePrice: number) => {
            const variation = (Math.random() - 0.5) * 0.02
            return basePrice * (1 + variation)
        }

        return {
            XLM: {
                price: addVariation(0.354),
                change: (Math.random() - 0.5) * 4,
                timestamp: now,
                source: 'fallback_browser'
            },
            USDC: {
                price: addVariation(1.0),
                change: (Math.random() - 0.5) * 0.1,
                timestamp: now,
                source: 'fallback_browser'
            },
            BTC: {
                price: addVariation(110000),
                change: (Math.random() - 0.5) * 6,
                timestamp: now,
                source: 'fallback_browser'
            },
            ETH: {
                price: addVariation(4200),
                change: (Math.random() - 0.5) * 5,
                timestamp: now,
                source: 'fallback_browser'
            }
        }
    }

    clearCache(): void {
        this.cache.clear()
        console.log('Browser price cache cleared')
    }

    async testConnection(): Promise<{ success: boolean, error?: string }> {
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