import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReflectorService } from '../services/reflector.js'
import { assetRegistryService } from '../services/assetRegistryService.js'
import { databaseService } from '../services/databaseService.js'
import { logger } from '../utils/logger.js'
import { evaluateReflectorPriceUpdate } from '../services/priceIngestionBoundary.js'

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

describe('Reflector price ingestion boundary (SPR-2026-105)', () => {
    it('accepts an update exactly at the configured freshness limit', () => {
        const decision = evaluateReflectorPriceUpdate({
            asset: 'XLM',
            source: 'reflector',
            price: 0.354,
            timestamp: nowSec - 600,
            ledger: 200,
            maxAgeSeconds: 600,
            nowMs: nowSec * 1000,
        })

        expect(decision).toMatchObject({
            result: 'accepted',
            reasonCode: 'FRESH_AT_LIMIT',
            source: 'reflector',
            observedLedger: 200,
            acceptedLedger: 200,
            acceptedPrice: 0.354,
            shouldPersist: true,
            ageMs: 600000,
        })
    })

    it('rejects a quote from an older ledger and keeps the last accepted price', () => {
        const decision = evaluateReflectorPriceUpdate({
            asset: 'XLM',
            source: 'reflector',
            price: 0.36,
            timestamp: nowSec,
            ledger: 199,
            maxAgeSeconds: 600,
            nowMs: nowSec * 1000,
            lastAccepted: { source: 'reflector', price: 0.354, ledger: 200 },
        })

        expect(decision).toMatchObject({
            result: 'rejected',
            reasonCode: 'OLDER_LEDGER',
            source: 'reflector',
            observedPrice: 0.36,
            observedLedger: 199,
            acceptedPrice: 0.354,
            acceptedLedger: 200,
            acceptedSource: 'reflector',
            shouldPersist: false,
        })
    })

    describe('service boundary with isolated DB and RPC doubles', () => {
        let service: ReflectorService
        let freshness: any
        let warn: any

        beforeEach(() => {
            vi.useFakeTimers()
            vi.setSystemTime(nowSec * 1000)
            vi.stubEnv('REFLECTOR_API_URL', 'https://reflector.example')
            vi.stubEnv('PRICE_DATA_MAX_AGE', '600')
            vi.stubEnv('ALLOW_FALLBACK_PRICES', 'false')
            vi.stubEnv('ORACLE_CACHE_TTL_SECONDS', '0')
            vi.spyOn(assetRegistryService, 'getSymbols').mockReturnValue(['XLM'])
            vi.spyOn(assetRegistryService, 'getCoingeckoIdMap').mockReturnValue({ XLM: 'stellar' })
            freshness = vi.spyOn(databaseService, 'setAssetFreshness').mockReturnValue(true)
            warn = vi.spyOn(logger, 'warn')
        })

        afterEach(() => {
            service?.stopCacheMetricsReporting()
            vi.useRealTimers()
            vi.unstubAllEnvs()
            vi.unstubAllGlobals()
            vi.restoreAllMocks()
        })

        it('records source, ledger and accepted price once and ignores an older ledger replay', async () => {
            const urllib = 'https://reflector.example/prices?assets=XLM'
            const fetchMock = vi.fn(async (url: string) => {
                if (String(url).includes('coingecko')) {
                    return response({ stellar: { usd: 0.361, last_updated_at: nowSec + 91 } })
                }
                if (String(url) === urllib && fetchMock.mock.calls.length <= 1) {
                    return response({ prices: {
                        XLM: { price: '3540000', decimals: 7, timestamp: nowSec - 600, ledger: 200 },
                    } })
                }
                return response({ prices: {
                    XLM: { price: '3600000', decimals: 7, timestamp: nowSec + 91, ledger: 199 },
                } })
            })
            vi.stubGlobal('fetch', fetchMock)
            service = new ReflectorService()

            const first = await service.getCurrentPricesWithMeta()

            expect(first.prices.XLM).toMatchObject({
                source: 'reflector',
                price: 0.354,
                ledger: 200,
            })
            expect(freshness).toHaveBeenCalledExactlyOnceWith('XLM', new Date(nowSec * 1000).toISOString(), false)

            vi.advanceTimersByTime(91_000)
            service.clearCache()
            const second = await service.getCurrentPricesWithMeta()

            expect(second.prices.XLM).toMatchObject({ source: 'coingecko_free', price: 0.361 })
            expect((service as any).acceptedQuotes.get('XLM')).toEqual({
                source: 'reflector',
                price: 0.354,
                ledger: 200,
            })
            expect(warn).toHaveBeenCalledWith('[ORACLE] price_ingestion', expect.objectContaining({
                outcome: 'blocked',
                reasonCode: 'OLDER_LEDGER',
                asset: 'XLM',
                observedLedger: 199,
                acceptedLedger: 200,
                acceptedPrice: 0.354,
            }))
            expect(freshness).toHaveBeenCalledTimes(2)
            expect(warn).toHaveBeenCalledTimes(1)
        })
    })
})
