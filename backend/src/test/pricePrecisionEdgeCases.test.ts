import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReflectorService } from '../services/reflector.js'
import { assetRegistryService } from '../services/assetRegistryService.js'
import { databaseService } from '../services/databaseService.js'
import { normalizeScaledQuote } from '../utils/quotePrecision.js'

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

const response = (body: unknown, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
})

const nowSec = Date.UTC(2026, 0, 1) / 1000

describe('cross-asset quote precision (SPR-2026-115)', () => {
    let service: ReflectorService
    let freshness: any

    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(nowSec * 1000)
        vi.stubEnv('REFLECTOR_API_URL', 'https://reflector.example')
        vi.stubEnv('PRICE_DATA_MAX_AGE', '600')
        vi.stubEnv('ALLOW_FALLBACK_PRICES', 'false')
        vi.stubEnv('ORACLE_CACHE_TTL_SECONDS', '0')
        vi.spyOn(assetRegistryService, 'getSymbols').mockReturnValue(['XLM', 'BTC'])
        vi.spyOn(assetRegistryService, 'getCoingeckoIdMap').mockReturnValue({ XLM: 'stellar', BTC: 'bitcoin' })
        freshness = vi.spyOn(databaseService, 'setAssetFreshness').mockReturnValue(true)
    })

    afterEach(() => {
        service?.stopCacheMetricsReporting()
        vi.useRealTimers()
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('conserves integer units for different decimal scales without duplicate side effects', async () => {
        const xlmUnits = '3540000'
        const btcUnits = '10500000000000'
        const fetchMock = vi.fn().mockResolvedValue(response({ prices: {
            XLM: { price: xlmUnits, decimals: 7, timestamp: nowSec },
            BTC: { price: btcUnits, decimals: 8, timestamp: nowSec },
        } }))
        vi.stubGlobal('fetch', fetchMock)
        service = new ReflectorService()

        const { prices } = await service.getCurrentPricesWithMeta()

        expect(prices.XLM.price).toBe(0.354)
        expect(prices.BTC.price).toBe(105000)
        expect(normalizeScaledQuote(xlmUnits, 7)).toEqual({ price: 0.354, units: '3540000', decimals: 7 })
        expect(normalizeScaledQuote(btcUnits, 8)).toEqual({ price: 105000, units: '10500000000000', decimals: 8 })
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(freshness).toHaveBeenCalledTimes(2)
        expect(freshness).toHaveBeenCalledWith('XLM', new Date(nowSec * 1000).toISOString(), false)
        expect(freshness).toHaveBeenCalledWith('BTC', new Date(nowSec * 1000).toISOString(), false)
    })

    it('blocks an overflowing intermediate and keeps the accepted sibling units', async () => {
        const unsafeUnits = '9007199254740997'
        const btcUnits = '10000000000000000'
        const fetchMock = vi.fn()
            .mockResolvedValue(response({ prices: {
                XLM: { price: unsafeUnits, decimals: 7, timestamp: nowSec },
                BTC: { price: btcUnits, decimals: 8, timestamp: nowSec },
            } }))
        vi.stubGlobal('fetch', fetchMock)
        service = new ReflectorService()

        const { prices, feedMeta } = await service.getCurrentPricesWithMeta()

        expect(prices.XLM).toBeUndefined()
        expect(prices.BTC.price).toBe(100000000)
        expect(normalizeScaledQuote(btcUnits, 8).units).toBe(btcUnits)
        expect(feedMeta).toMatchObject({ resolutionHint: 'partial_merge', staleOrLimited: true })
        expect(() => normalizeScaledQuote(unsafeUnits, 7)).toThrow(RangeError)
        expect(() => normalizeScaledQuote('1' + '0'.repeat(317), 8)).toThrow(RangeError)
        expect(freshness).toHaveBeenCalledExactlyOnceWith('BTC', new Date(nowSec * 1000).toISOString(), false)
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(freshness).toHaveBeenCalledTimes(1)
    })
})
