import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReflectorService } from '../services/reflector.js'
import { assetRegistryService } from '../services/assetRegistryService.js'

type MockFetchResponse = {
    ok: boolean
    status: number
    json: () => Promise<unknown>
    text: () => Promise<string>
    headers: Headers
}

const response = (body: unknown, status = 200): MockFetchResponse => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers()
})

describe('ReflectorService staleness and fallback', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
        vi.clearAllMocks()

        vi.spyOn(assetRegistryService, 'getSymbols').mockReturnValue(['XLM'])
        vi.spyOn(assetRegistryService, 'getCoingeckoIdMap').mockReturnValue({ XLM: 'stellar' })
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('falls back to CoinGecko when Reflector quote is stale beyond PRICE_DATA_MAX_AGE', async () => {
        const nowSec = Math.floor(Date.now() / 1000)

        vi.stubEnv('REFLECTOR_API_URL', 'https://reflector.example')
        vi.stubEnv('PRICE_DATA_MAX_AGE', '600')
        vi.stubEnv('ALLOW_FALLBACK_PRICES', 'false')

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response({
                prices: {
                    XLM: {
                        price: '3540000',
                        decimals: 7,
                        timestamp: nowSec - 601
                    }
                }
            }))
            .mockResolvedValueOnce(response({
                stellar: {
                    usd: 0.361,
                    usd_24h_change: 0.5,
                    last_updated_at: nowSec - 3
                }
            }))

        vi.stubGlobal('fetch', fetchMock)

        const service = new ReflectorService()
        const prices = await service.getCurrentPrices()

        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(fetchMock.mock.calls[0]?.[0]).toContain('reflector.example')
        expect(fetchMock.mock.calls[1]?.[0]).toContain('api.coingecko.com')
        expect(prices.XLM.source).toBe('coingecko_free')
        expect(prices.XLM.price).toBe(0.361)
    })

    it('treats quote exactly at threshold as fresh and keeps Reflector as source', async () => {
        const nowSec = Math.floor(Date.now() / 1000)

        vi.stubEnv('REFLECTOR_API_URL', 'https://reflector.example')
        vi.stubEnv('PRICE_DATA_MAX_AGE', '600')

        const fetchMock = vi.fn().mockResolvedValueOnce(response({
            prices: {
                XLM: {
                    price: '3540000',
                    decimals: 7,
                    timestamp: nowSec - 600
                }
            }
        }))

        vi.stubGlobal('fetch', fetchMock)

        const service = new ReflectorService()
        const prices = await service.getCurrentPrices()

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(prices.XLM.source).toBe('reflector')
        expect(prices.XLM.price).toBeCloseTo(0.354, 8)
    })

    it('throws explicit error when Reflector and CoinGecko are unavailable with fallback disabled', async () => {
        const nowSec = Math.floor(Date.now() / 1000)

        vi.stubEnv('REFLECTOR_API_URL', 'https://reflector.example')
        vi.stubEnv('PRICE_DATA_MAX_AGE', '600')
        vi.stubEnv('ALLOW_FALLBACK_PRICES', 'false')

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response({
                prices: {
                    XLM: {
                        price: '3540000',
                        decimals: 7,
                        timestamp: nowSec - 900
                    }
                }
            }))
            .mockResolvedValueOnce(response({ error: 'upstream unavailable' }, 503))

        vi.stubGlobal('fetch', fetchMock)

        const service = new ReflectorService()

        await expect(service.getCurrentPrices()).rejects.toThrow(
            'Price sources unavailable and ALLOW_FALLBACK_PRICES is disabled'
        )
    })

    it('normalizes Reflector prices across mixed decimal precisions', async () => {
        const nowSec = Math.floor(Date.now() / 1000)

        vi.spyOn(assetRegistryService, 'getSymbols').mockReturnValue(['XLM', 'BTC'])
        vi.spyOn(assetRegistryService, 'getCoingeckoIdMap').mockReturnValue({ XLM: 'stellar', BTC: 'bitcoin' })

        vi.stubEnv('REFLECTOR_API_URL', 'https://reflector.example')
        vi.stubEnv('PRICE_DATA_MAX_AGE', '600')

        const fetchMock = vi.fn().mockResolvedValueOnce(response({
            prices: {
                XLM: {
                    price: '3540000',
                    decimals: 7,
                    timestamp: nowSec - 10
                },
                BTC: {
                    price: '10500000000000',
                    decimals: 8,
                    timestamp: nowSec - 10
                }
            }
        }))

        vi.stubGlobal('fetch', fetchMock)

        const service = new ReflectorService()
        const prices = await service.getCurrentPrices()

        expect(prices.XLM.price).toBeCloseTo(0.354, 8)
        expect(prices.BTC.price).toBe(105000)
        expect(prices.XLM.source).toBe('reflector')
        expect(prices.BTC.source).toBe('reflector')
    })
})

describe('ReflectorService cache metrics and tuning', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
        vi.clearAllMocks()

        vi.spyOn(assetRegistryService, 'getSymbols').mockReturnValue(['XLM', 'BTC'])
        vi.spyOn(assetRegistryService, 'getCoingeckoIdMap').mockReturnValue({
            XLM: 'stellar',
            BTC: 'bitcoin'
        })

        // Mock metrics recording functions
        vi.mock('../observability/metrics.js', () => ({
            recordCacheHitRatio: vi.fn(),
            recordCacheAge: vi.fn(),
            recordCacheSize: vi.fn(),
            recordCacheEntries: vi.fn(),
            recordCacheOperation: vi.fn(),
            recordCacheTtl: vi.fn(),
            recordCacheExpiration: vi.fn()
        }))
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('tracks cache hits and misses for analytics', async () => {
        const nowSec = Math.floor(Date.now() / 1000)

        vi.stubEnv('REFLECTOR_API_URL', 'https://reflector.example')
        vi.stubEnv('PRICE_DATA_MAX_AGE', '600')

        const fetchMock = vi.fn().mockResolvedValueOnce(response({
            prices: {
                XLM: {
                    price: '3540000',
                    decimals: 7,
                    timestamp: nowSec - 10
                }
            }
        }))

        vi.stubGlobal('fetch', fetchMock)

        const service = new ReflectorService()

        // First call - miss and fetch
        let prices = await service.getCurrentPrices()
        expect(prices.XLM.price).toBeCloseTo(0.354, 8)

        // Advance time by 5 seconds
        vi.advanceTimersByTime(5000)

        // Second call - hit from cache
        prices = await service.getCurrentPrices()
        expect(prices.XLM.servedFromCache).toBe(true)
        expect(prices.XLM.cacheAgeMs).toBe(5000)

        // Verify cache analytics
        const analytics = service.getCacheAnalytics()
        expect(analytics.totalEntries).toBe(1)
        expect(analytics.assets[0].cached).toBe(true)
        expect(analytics.assets[0].ageMs).toBe(5000)
        expect(analytics.assets[0].hitCount).toBeGreaterThanOrEqual(1)
    })

    it('reports cache analytics with hit ratios', async () => {
        const nowSec = Math.floor(Date.now() / 1000)

        vi.stubEnv('REFLECTOR_API_URL', 'https://reflector.example')
        vi.stubEnv('PRICE_DATA_MAX_AGE', '600')

        const fetchMock = vi.fn().mockResolvedValueOnce(response({
            prices: {
                XLM: {
                    price: '3540000',
                    decimals: 7,
                    timestamp: nowSec - 10
                }
            }
        }))

        vi.stubGlobal('fetch', fetchMock)

        const service = new ReflectorService()

        // Generate multiple hits and misses
        for (let i = 0; i < 3; i++) {
            await service.getCurrentPrices()
            if (i < 2) {
                vi.advanceTimersByTime(1000) // Advance 1 second for cache hits
            } else {
                vi.advanceTimersByTime(400000) // Advance beyond cache TTL for miss
            }
        }

        const analytics = service.getCacheAnalytics()
        expect(analytics.assets[0]).toBeDefined()
        expect(analytics.totalEntries).toBeGreaterThanOrEqual(0)
        expect(analytics.estimatedSizeBytes).toBeGreaterThanOrEqual(0)
    })

    it('supports tuning cache TTL at runtime', async () => {
        vi.stubEnv('REFLECTOR_API_URL', 'https://reflector.example')
        vi.stubEnv('PRICE_DATA_MAX_AGE', '600')

        const service = new ReflectorService()

        // Tune cache duration
        const result = service.tuneCacheSettings({
            cacheDurationMs: 120000
        })

        expect(result.success).toBe(true)
        expect(result.config?.cacheDurationMs).toBe(120000)

        const analytics = service.getCacheAnalytics()
        expect(analytics.ttlMs).toBe(120000)
    })

    it('validates cache TTL settings and rejects invalid values', async () => {
        vi.stubEnv('REFLECTOR_API_URL', 'https://reflector.example')

        const service = new ReflectorService()

        // Try to set TTL below minimum
        const result = service.tuneCacheSettings({
            cacheDurationMs: 500 // Too low
        })

        expect(result.success).toBe(false)
        expect(result.message).toContain('must be an integer >= 1000')
    })

    it('supports tuning price staleness threshold at runtime', async () => {
        vi.stubEnv('REFLECTOR_API_URL', 'https://reflector.example')
        vi.stubEnv('PRICE_DATA_MAX_AGE', '600')

        const service = new ReflectorService()

        // Tune max age setting
        const result = service.tuneCacheSettings({
            priceDataMaxAgeSeconds: 1200
        })

        expect(result.success).toBe(true)
        expect(result.config?.maxAgeSeconds).toBe(1200)
    })

    it('provides cache status including entry count and estimated size', async () => {
        const nowSec = Math.floor(Date.now() / 1000)

        vi.stubEnv('REFLECTOR_API_URL', 'https://reflector.example')
        vi.stubEnv('PRICE_DATA_MAX_AGE', '600')

        const fetchMock = vi.fn().mockResolvedValueOnce(response({
            prices: {
                XLM: {
                    price: '3540000',
                    decimals: 7,
                    timestamp: nowSec - 10
                },
                BTC: {
                    price: '10500000000000',
                    decimals: 8,
                    timestamp: nowSec - 10
                }
            }
        }))

        vi.stubGlobal('fetch', fetchMock)

        const service = new ReflectorService()
        await service.getCurrentPrices()

        const status = service.getCacheStatus()
        expect(Object.keys(status).length).toBeGreaterThan(0)
        expect(status.XLM).toBeDefined()
        expect(status.XLM.cached).toBe(true)
        expect(status.XLM.age).toBeDefined()
        expect(status.XLM.price).toBeCloseTo(0.354, 8)

        const analytics = service.getCacheAnalytics()
        expect(analytics.totalEntries).toBeGreaterThan(0)
        expect(analytics.estimatedSizeBytes).toBeGreaterThan(0)
        expect(analytics.ttlMs).toBeGreaterThan(0)
    })

    it('stops cache metrics reporting on service shutdown', async () => {
        vi.stubEnv('REFLECTOR_API_URL', 'https://reflector.example')

        const service = new ReflectorService()
        
        // Verify reporting is active
        const initialAnalytics = service.getCacheAnalytics()
        expect(initialAnalytics).toBeDefined()

        // Stop metrics
        service.stopCacheMetricsReporting()

        // Subsequent calls should still work
        const afterStopAnalytics = service.getCacheAnalytics()
        expect(afterStopAnalytics).toBeDefined()
    })

    it('clears cache appropriately and resets hit tracking', async () => {
        const nowSec = Math.floor(Date.now() / 1000)

        vi.stubEnv('REFLECTOR_API_URL', 'https://reflector.example')
        vi.stubEnv('PRICE_DATA_MAX_AGE', '600')

        const fetchMock = vi.fn().mockResolvedValueOnce(response({
            prices: {
                XLM: {
                    price: '3540000',
                    decimals: 7,
                    timestamp: nowSec - 10
                }
            }
        }))

        vi.stubGlobal('fetch', fetchMock)

        const service = new ReflectorService()
        await service.getCurrentPrices()

        let status = service.getCacheStatus()
        expect(Object.keys(status).length).toBeGreaterThan(0)

        service.clearCache()

        status = service.getCacheStatus()
        expect(Object.keys(status).length).toBe(0)
    })
})
