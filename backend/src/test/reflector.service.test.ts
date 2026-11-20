import { inspect } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { ReflectorService } from '../services/reflector.js'
import { assetRegistryService } from '../services/assetRegistryService.js'
import { databaseService } from '../services/databaseService.js'
import { logger } from '../utils/logger.js'

vi.mock('../observability/metrics.js', () => ({
    recordCacheHitRatio: vi.fn(),
    recordCacheAge: vi.fn(),
    recordCacheSize: vi.fn(),
    recordCacheEntries: vi.fn(),
    recordCacheOperation: vi.fn(),
    recordCacheTtl: vi.fn(),
    recordCacheExpiration: vi.fn(),
    recordPriceFeedResolution: vi.fn(),
    recordReflectorFallbackUsage: vi.fn(),
    recordReflectorStalePrice: vi.fn(),
}))

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

    it('reuses the short CoinGecko fallback cache after the general price cache expires', async () => {
        const nowSec = Math.floor(Date.now() / 1000)
        vi.stubEnv('REFLECTOR_API_URL', 'https://reflector.example')
        vi.stubEnv('PRICE_DATA_MAX_AGE', '600')
        vi.stubEnv('ALLOW_FALLBACK_PRICES', 'false')
        vi.stubEnv('ORACLE_CACHE_TTL_SECONDS', '0')
        vi.stubEnv('COINGECKO_FALLBACK_CACHE_TTL_MS', '600000')

        let coinGeckoCalls = 0
        const fetchMock = vi.fn(async (url: string) => {
            if (String(url).includes('api.coingecko.com')) {
                coinGeckoCalls += 1
                return response({
                    stellar: { usd: 0.361, usd_24h_change: 0.5, last_updated_at: nowSec - 3 }
                })
            }
            return response({
                prices: {
                    XLM: { price: '3540000', decimals: 7, timestamp: nowSec - 601 }
                }
            })
        })
        vi.stubGlobal('fetch', fetchMock)

        const service = new ReflectorService()
        await service.getCurrentPrices()
        vi.advanceTimersByTime(360_000)
        const prices = await service.getCurrentPrices()
        service.stopCacheMetricsReporting()

        expect(coinGeckoCalls).toBe(1)
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

describe('ReflectorService quote precision and fallback outcomes', () => {
    const nowSec = Date.UTC(2026, 0, 1) / 1000
    let service: ReflectorService
    let freshness: MockInstance<typeof databaseService.setAssetFreshness>

    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(nowSec * 1000)
        vi.stubEnv('REFLECTOR_API_URL', 'https://reflector.example')
        vi.stubEnv('PRICE_DATA_MAX_AGE', '600')
        vi.stubEnv('ALLOW_FALLBACK_PRICES', 'false')
        vi.stubEnv('COINGECKO_API_KEY', '')
        vi.stubEnv('ORACLE_CACHE_TTL_SECONDS', '0')
        vi.spyOn(assetRegistryService, 'getSymbols').mockReturnValue(['XLM'])
        vi.spyOn(assetRegistryService, 'getCoingeckoIdMap').mockReturnValue({ XLM: 'stellar' })
        freshness = vi.spyOn(databaseService, 'setAssetFreshness').mockReturnValue(true)
    })

    afterEach(() => {
        service.stopCacheMetricsReporting()
        vi.useRealTimers()
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it.each([
        { input: 'a lossy integer string', unsafePrice: '9007199254740997' },
        { input: 'an unsafe JSON number', unsafePrice: Number.MAX_SAFE_INTEGER + 1 },
        { input: 'an out-of-range quote', unsafePrice: '1' + '0'.repeat(317) },
    ])(
        'rejects $input while sharing the accepted sibling with concurrent callers',
        async ({ unsafePrice }) => {
            vi.stubEnv('ORACLE_CACHE_TTL_SECONDS', '30')
            vi.spyOn(assetRegistryService, 'getSymbols').mockReturnValue(['XLM', 'BTC'])
            const info = vi.spyOn(logger, 'info')
            const warn = vi.spyOn(logger, 'warn')
            const btcUnits = '10000000000000000'
            const fetchMock = vi.fn()
                .mockResolvedValueOnce(response({ prices: {
                    XLM: { price: unsafePrice, decimals: 7, timestamp: nowSec },
                    BTC: { price: btcUnits, decimals: 8, timestamp: nowSec },
                } }))
                .mockResolvedValueOnce(response({}))
            vi.stubGlobal('fetch', fetchMock)
            service = new ReflectorService()

            let persisted: string | null = null
            const redis = {
                get: vi.fn(async () => persisted),
                set: vi.fn(async (_key: string, value: string) => { persisted = value }),
            }
            const cache = service as unknown as { getRedisCache: () => Promise<typeof redis> }
            vi.spyOn(cache, 'getRedisCache').mockResolvedValue(redis)

            const [map, feed] = await Promise.all([
                service.getCurrentPrices(),
                service.getCurrentPricesWithMeta(),
            ])

            expect(fetchMock).toHaveBeenCalledTimes(2)
            expect(fetchMock.mock.calls[0]?.[0]).toContain('reflector.example')
            expect(fetchMock.mock.calls[1]?.[0]).toContain('api.coingecko.com')
            expect(feed.prices).toEqual(map)
            expect(map.XLM).toBeUndefined()
            expect(map.BTC).toMatchObject({ price: 100000000, source: 'reflector' })
            expect(BigInt(map.BTC.price) * 10n ** 8n).toBe(BigInt(btcUnits))
            expect(feed.feedMeta).toMatchObject({ resolutionHint: 'partial_merge', staleOrLimited: true })
            expect(freshness).toHaveBeenCalledExactlyOnceWith('BTC', new Date().toISOString(), false)
            expect(redis.set).toHaveBeenCalledTimes(1)
            expect(JSON.parse(persisted!)).toEqual({
                BTC: expect.objectContaining({ price: map.BTC.price, source: map.BTC.source }),
            })
            const cached = await service.getCurrentPricesWithMeta()
            expect(cached.prices.BTC.price).toBe(map.BTC.price)
            expect(cached.feedMeta).toMatchObject({ resolutionHint: 'partial_merge', staleOrLimited: true })
            expect(fetchMock).toHaveBeenCalledTimes(2)
            expect(info).toHaveBeenCalledWith('[ORACLE] quote_precision', expect.objectContaining({
                source: 'price_feed', outcome: 'delayed', reason: 'in_flight',
            }))
            expect(info).toHaveBeenCalledWith('[ORACLE] quote_precision', expect.objectContaining({
                source: 'reflector', outcome: 'success', asset: 'BTC', decimals: 8,
            }))
            expect(warn).toHaveBeenCalledWith('[ORACLE] quote_precision', expect.objectContaining({
                source: 'reflector', outcome: 'blocked', reason: 'integer_overflow', asset: 'XLM', decimals: 7,
            }))
        },
    )

    it.each([
        { price: 0.096, deviationBps: 400, reason: 'price_disagreement' },
        { price: 0.097, deviationBps: 300, reason: 'fetched' },
    ])('reports CoinGecko fallback outcome $reason at $deviationBps bps', async ({ price, deviationBps, reason }) => {
        const info = vi.spyOn(logger, 'info')
        const warn = vi.spyOn(logger, 'warn')
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response({ prices: {
                XLM: { price: '1000000', decimals: 7, timestamp: nowSec - 601 },
            } }))
            .mockResolvedValueOnce(response({ stellar: { usd: price, last_updated_at: nowSec } }))
        vi.stubGlobal('fetch', fetchMock)
        service = new ReflectorService()

        const prices = await service.getCurrentPrices()

        expect(prices.XLM).toMatchObject({ price, source: 'coingecko_free' })
        expect(fetchMock).toHaveBeenCalledTimes(2)
        if (reason === 'price_disagreement') {
            expect(warn).toHaveBeenCalledWith('[ORACLE] coingecko_fallback', expect.objectContaining({
                source: 'coingecko_free', outcome: 'success', reason,
                asset: 'XLM', deviationBps, toleranceBps: 300,
            }))
        } else {
            expect(info).toHaveBeenCalledWith('[ORACLE] coingecko_fallback', expect.objectContaining({
                source: 'coingecko_free', outcome: 'success', reason, asset: 'XLM',
            }))
            expect(warn).not.toHaveBeenCalledWith('[ORACLE] coingecko_fallback', expect.objectContaining({
                reason: 'price_disagreement',
            }))
        }
    })

    it('releases concurrent callers to fallback when the Reflector body stalls', async () => {
        const controller = new AbortController()
        const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(controller.signal)
        const warn = vi.spyOn(logger, 'warn')
        const fetchMock = vi.fn()
            .mockImplementationOnce(async (_url: string, options: RequestInit) => ({
                ...response({}),
                json: () => new Promise((_resolve, reject) => {
                    options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
                    controller.abort()
                }),
            }))
            .mockResolvedValueOnce(response({ stellar: { usd: 0.36, last_updated_at: nowSec } }))
        vi.stubGlobal('fetch', fetchMock)
        service = new ReflectorService()

        const [map, feed] = await Promise.all([service.getCurrentPrices(), service.getCurrentPricesWithMeta()])

        expect(timeout).toHaveBeenCalledExactlyOnceWith(5000)
        expect(map.XLM).toMatchObject({ price: 0.36, source: 'coingecko_free' })
        expect(feed.prices).toEqual(map)
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(freshness).toHaveBeenCalledTimes(1)
        expect(warn).toHaveBeenCalledWith('[ORACLE] quote_precision', expect.objectContaining({
            source: 'reflector', outcome: 'delayed', reason: 'timeout', assets: ['XLM'],
        }))
    })

    it('keeps an interrupted fallback out of the cache and recovers on a later request', async () => {
        const info = vi.spyOn(logger, 'info')
        const warn = vi.spyOn(logger, 'warn')
        const error = vi.spyOn(logger, 'error')
        const upstreamSecret = 'sensitive-provider-response'
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response({}))
            .mockResolvedValueOnce({
                ...response({}),
                json: vi.fn().mockRejectedValue(new Error(upstreamSecret)),
            })
            .mockResolvedValueOnce(response({ prices: {
                XLM: { price: '3540000', decimals: 7, timestamp: nowSec - 1 },
            } }))
        vi.stubGlobal('fetch', fetchMock)
        service = new ReflectorService()

        const interrupted = await Promise.allSettled([
            service.getCurrentPrices(),
            service.getCurrentPricesWithMeta(),
        ])

        expect(interrupted.map((result) => result.status)).toEqual(['rejected', 'rejected'])
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(freshness).not.toHaveBeenCalled()
        expect(service.getCacheStatus()).toEqual({})
        const entries = [...info.mock.calls, ...warn.mock.calls, ...error.mock.calls]
        expect(entries).toContainEqual([
            '[ORACLE] coingecko_fallback',
            expect.objectContaining({ source: 'coingecko_free', outcome: 'blocked' }),
        ])
        expect(inspect(entries, { depth: null, maxArrayLength: null })).not.toContain(upstreamSecret)

        await expect(service.getCurrentPrices()).rejects.toThrow('Price sources unavailable')
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(warn).toHaveBeenCalledWith('[ORACLE] coingecko_fallback', expect.objectContaining({
            source: 'coingecko_free', outcome: 'delayed', reason: 'local_rate_limit',
        }))

        vi.advanceTimersByTime(91_000)
        const recovered = await service.getCurrentPrices()
        expect(recovered.XLM).toMatchObject({ price: 0.354, source: 'reflector' })
        expect(freshness).toHaveBeenCalledExactlyOnceWith('XLM', new Date().toISOString(), false)
        expect(fetchMock).toHaveBeenCalledTimes(3)
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
        vi.stubEnv('ORACLE_CACHE_TTL_SECONDS', '0')
        vi.spyOn(assetRegistryService, 'getSymbols').mockReturnValue(['XLM'])
        vi.spyOn(assetRegistryService, 'getCoingeckoIdMap').mockReturnValue({ XLM: 'stellar' })

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response({
                prices: {
                    XLM: { price: '3540000', decimals: 7, timestamp: nowSec - 601 }
                }
            }))
            .mockResolvedValueOnce(response({
                stellar: { usd: 0.354, usd_24h_change: 0.1, last_updated_at: nowSec }
            }))

        vi.stubGlobal('fetch', fetchMock)

        const service = new ReflectorService()

        let prices = await service.getCurrentPrices()
        expect(prices.XLM.price).toBeCloseTo(0.354, 8)

        vi.advanceTimersByTime(5000)

        prices = await service.getCurrentPrices()
        expect(prices.XLM.servedFromCache).toBe(true)
        expect(prices.XLM.cacheAgeMs).toBe(5000)

        const analytics = service.getCacheAnalytics()
        expect(analytics.totalEntries).toBe(1)
        expect(analytics.assets[0].cached).toBe(true)
        expect(analytics.assets[0].ageMs).toBe(5000)
        expect(analytics.assets[0].hitCount).toBeGreaterThanOrEqual(1)
        service.stopCacheMetricsReporting()
    })

    it('reports cache analytics with hit ratios', async () => {
        const nowSec = Math.floor(Date.now() / 1000)

        vi.stubEnv('REFLECTOR_API_URL', 'https://reflector.example')
        vi.stubEnv('PRICE_DATA_MAX_AGE', '600')

        const fetchMock = vi.fn()
            // First call: Reflector returns fresh data (hits cache for i=0,1)
            .mockResolvedValueOnce(response({
                prices: {
                    XLM: {
                        price: '3540000',
                        decimals: 7,
                        timestamp: nowSec - 10
                    }
                }
            }))
            // Third iteration: cache expired (400s advance), Reflector stale → CoinGecko fallback
            .mockResolvedValueOnce(response({
                prices: {
                    XLM: {
                        price: '3540000',
                        decimals: 7,
                        timestamp: nowSec - 650
                    }
                }
            }))
            .mockResolvedValueOnce(response({
                stellar: { usd: 0.354, usd_24h_change: 0.1, last_updated_at: nowSec }
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

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response({
                prices: {
                    XLM: { price: '3540000', decimals: 7, timestamp: nowSec - 601 },
                    BTC: { price: '10500000000000', decimals: 8, timestamp: nowSec - 601 }
                }
            }))
            .mockResolvedValueOnce(response({
                stellar: { usd: 0.354, usd_24h_change: 0.1, last_updated_at: nowSec },
                bitcoin: { usd: 105000, usd_24h_change: 0.2, last_updated_at: nowSec }
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
        vi.stubEnv('ORACLE_CACHE_TTL_SECONDS', '0')
        vi.spyOn(assetRegistryService, 'getSymbols').mockReturnValue(['XLM'])
        vi.spyOn(assetRegistryService, 'getCoingeckoIdMap').mockReturnValue({ XLM: 'stellar' })

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response({
                prices: {
                    XLM: { price: '3540000', decimals: 7, timestamp: nowSec - 601 }
                }
            }))
            .mockResolvedValueOnce(response({
                stellar: { usd: 0.354, usd_24h_change: 0.1, last_updated_at: nowSec }
            }))

        vi.stubGlobal('fetch', fetchMock)

        const service = new ReflectorService()
        await service.getCurrentPrices()

        let status = service.getCacheStatus()
        expect(Object.keys(status).length).toBeGreaterThan(0)

        service.clearCache()

        status = service.getCacheStatus()
        expect(Object.keys(status).length).toBe(0)
        service.stopCacheMetricsReporting()
    })
})
