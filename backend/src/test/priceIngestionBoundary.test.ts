import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { ReflectorService } from '../services/reflector.js'
import { assetRegistryService } from '../services/assetRegistryService.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseService, databaseService } from '../services/databaseService.js'
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
        let store: DatabaseService
        let directory: string
        let freshness: MockInstance<typeof DatabaseService.prototype.setAssetFreshness>
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
            directory = mkdtempSync(join(tmpdir(), 'reflector-ingestion-'))
            vi.stubEnv('DB_PATH', join(directory, 'oracle.db'))
            store = new DatabaseService()
            vi.spyOn(databaseService, 'acceptReflectorQuote').mockImplementation((input) => store.acceptReflectorQuote(input))
            vi.spyOn(databaseService, 'getAcceptedReflectorQuote').mockImplementation((symbol) => store.getAcceptedReflectorQuote(symbol))
            freshness = vi.spyOn(store, 'setAssetFreshness')
            warn = vi.spyOn(logger, 'warn')
        })

        afterEach(() => {
            service?.stopCacheMetricsReporting()
            store.close()
            rmSync(directory, { recursive: true, force: true })
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
            service.stopCacheMetricsReporting()
            store.close()
            store = new DatabaseService()
            service = new ReflectorService()
            const second = await service.getCurrentPricesWithMeta()

            expect(second.prices.XLM).toMatchObject({ source: 'coingecko_free', price: 0.361 })
            expect(store.getAcceptedReflectorQuote('XLM')).toEqual({
                source: 'reflector',
                price: 0.354,
                ledger: 200,
                timestamp: nowSec - 600,
            })
            expect(warn).toHaveBeenCalledWith('[ORACLE] price_ingestion', expect.objectContaining({
                outcome: 'blocked',
                reasonCode: 'OLDER_LEDGER',
                asset: 'XLM',
                observedLedger: 199,
                acceptedLedger: 200,
                acceptedPrice: 0.354,
            }))
            expect(freshness).toHaveBeenCalledTimes(1)
            expect(warn).toHaveBeenCalledTimes(1)
        })

        it('refreshes a stale Redis quote after a second connection commits a newer ledger', async () => {
            vi.stubEnv('ORACLE_CACHE_TTL_SECONDS', '30')
            const fetchMock = vi.fn().mockResolvedValue(response({
                prices: { XLM: { price: 0.35, ledger: 200, timestamp: nowSec } },
            }))
            vi.stubGlobal('fetch', fetchMock)
            service = new ReflectorService()

            let cached: string | null = null
            const redis = {
                get: vi.fn(async () => cached),
                set: vi.fn(async (_key: string, value: string) => { cached = value }),
            }
            const cache = service as unknown as { getRedisCache: () => Promise<typeof redis> }
            vi.spyOn(cache, 'getRedisCache').mockResolvedValue(redis)
            const first = await service.getCurrentPricesWithMeta()
            expect(first.prices.XLM).toMatchObject({ price: 0.35, ledger: 200 })

            vi.advanceTimersByTime(1000)
            const otherConnection = new DatabaseService()
            const newer = { source: 'reflector', price: 0.36, ledger: 201, timestamp: nowSec + 1 } as const
            try {
                expect(otherConnection.acceptReflectorQuote({
                    ...newer, asset: 'XLM', nowMs: Date.now(), maxAgeSeconds: 600,
                }).result).toBe('accepted')
            } finally {
                otherConnection.close()
            }
            fetchMock.mockResolvedValueOnce(response({ prices: { XLM: newer } }))

            const refreshed = await service.getCurrentPricesWithMeta()
            expect(refreshed.feedMeta.cacheStatus).toBe('redis_miss')
            expect(refreshed.prices.XLM).toMatchObject(newer)
            const cacheHit = await service.getCurrentPricesWithMeta()
            expect(cacheHit.feedMeta.cacheStatus).toBe('redis_hit')
            expect(cacheHit.prices.XLM).toMatchObject(newer)
            expect(fetchMock).toHaveBeenCalledTimes(2)
            expect(redis.set).toHaveBeenCalledTimes(2)
        })

        it('rolls back an interrupted quote and freshness write before concurrent callers can see it', async () => {
            const quote = (price: number, ledger: number, timestamp: number) =>
                response({ prices: { XLM: { price, ledger, timestamp } } })
            const fetchMock = vi.fn()
                .mockResolvedValueOnce(quote(0.35, 200, nowSec))
                .mockResolvedValueOnce(quote(0.38, 202, nowSec + 91))
                .mockResolvedValueOnce(response({}, 503))
                .mockResolvedValueOnce(quote(0.36, 201, nowSec + 182))
            vi.stubGlobal('fetch', fetchMock)
            service = new ReflectorService()

            const first = await service.getCurrentPrices()
            expect(first.XLM).toMatchObject({ source: 'reflector', ledger: 200, price: 0.35 })
            const previouslyAccepted = store.getAcceptedReflectorQuote('XLM')
            const previousFreshness = store.getAssetBySymbol('XLM')?.lastRefreshedAt
            expect(previousFreshness).toBe(new Date(nowSec * 1000).toISOString())

            const writeFreshness = DatabaseService.prototype.setAssetFreshness.bind(store)
            freshness.mockImplementationOnce((...args) => {
                writeFreshness(...args)
                throw new Error('interrupted SQLite write')
            })

            vi.advanceTimersByTime(91_000)
            const interrupted = await Promise.allSettled([
                service.getCurrentPrices(),
                service.getCurrentPricesWithMeta(),
            ])
            expect(interrupted.map(({ status }) => status)).toEqual(['rejected', 'rejected'])
            expect(fetchMock).toHaveBeenCalledTimes(3)
            expect(freshness).toHaveBeenCalledTimes(2)
            expect(store.getAcceptedReflectorQuote('XLM')).toEqual(previouslyAccepted)
            expect(store.getAssetBySymbol('XLM')?.lastRefreshedAt).toBe(previousFreshness)

            vi.advanceTimersByTime(91_000)
            const recovered = await service.getCurrentPricesWithMeta()
            expect(recovered.prices.XLM).toMatchObject({ source: 'reflector', ledger: 201, price: 0.36 })
            expect(recovered.prices.XLM).toMatchObject(store.getAcceptedReflectorQuote('XLM')!)
            expect(store.getAssetBySymbol('XLM')?.lastRefreshedAt).toBe(new Date().toISOString())
            expect(freshness).toHaveBeenCalledTimes(3)
        })
    })
})
