import { inspect } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReflectorService } from '../services/reflector.js'
import { assetRegistryService } from '../services/assetRegistryService.js'
import { DatabaseService, databaseService } from '../services/databaseService.js'
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

const response = (body: unknown, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
})

const nowSec = Date.UTC(2026, 0, 1) / 1000

describe('Reflector price ingestion outcomes (SPR-2026-104)', () => {
    let service: ReflectorService
    let store: DatabaseService
    let directory: string
    let info: MockInstance<typeof logger.info>
    let warn: MockInstance<typeof logger.warn>

    const ingestionCalls = (spy: MockInstance<any>) =>
        spy.mock.calls.filter(([message]) => message === '[ORACLE] price_ingestion')

    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(nowSec * 1000)
        vi.stubEnv('REFLECTOR_API_URL', 'https://reflector.example')
        vi.stubEnv('PRICE_DATA_MAX_AGE', '600')
        vi.stubEnv('ALLOW_FALLBACK_PRICES', 'false')
        vi.stubEnv('ORACLE_CACHE_TTL_SECONDS', '0')
        vi.stubEnv('COINGECKO_API_KEY', '')
        vi.spyOn(assetRegistryService, 'getSymbols').mockReturnValue(['XLM'])
        vi.spyOn(assetRegistryService, 'getCoingeckoIdMap').mockReturnValue({ XLM: 'stellar' })
        directory = mkdtempSync(join(tmpdir(), 'reflector-outcomes-'))
        vi.stubEnv('DB_PATH', join(directory, 'oracle.db'))
        store = new DatabaseService()
        vi.spyOn(databaseService, 'acceptReflectorQuote').mockImplementation((input) => store.acceptReflectorQuote(input))
        vi.spyOn(databaseService, 'getAcceptedReflectorQuote').mockImplementation((symbol) => store.getAcceptedReflectorQuote(symbol))
        info = vi.spyOn(logger, 'info')
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

    it('reports a success outcome with source, ledger and accepted price for a fresh quote', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
            prices: { XLM: { price: '3540000', decimals: 7, timestamp: nowSec - 5, ledger: 200 } },
        })))
        service = new ReflectorService()

        const prices = await service.getCurrentPrices()

        expect(prices.XLM).toMatchObject({ source: 'reflector', price: 0.354, ledger: 200 })
        expect(ingestionCalls(info)).toEqual([
            ['[ORACLE] price_ingestion', expect.objectContaining({
                source: 'reflector',
                asset: 'XLM',
                outcome: 'success',
                reasonCode: 'FRESH',
                observedLedger: 200,
                acceptedLedger: 200,
                acceptedPrice: 0.354,
            })],
        ])
        expect(ingestionCalls(warn)).toEqual([])
    })

    it('reports a delayed outcome with quote age when the oracle returns a stale quote', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response({
                prices: { XLM: { price: '3540000', decimals: 7, timestamp: nowSec - 601, ledger: 199 } },
            }))
            .mockResolvedValueOnce(response({
                stellar: { usd: 0.361, last_updated_at: nowSec - 3 },
            }))
        vi.stubGlobal('fetch', fetchMock)
        service = new ReflectorService()

        const prices = await service.getCurrentPrices()

        expect(prices.XLM).toMatchObject({ source: 'coingecko_free', price: 0.361 })
        expect(ingestionCalls(info)).toEqual([])
        expect(ingestionCalls(warn)).toEqual([
            ['[ORACLE] price_ingestion', expect.objectContaining({
                source: 'reflector',
                asset: 'XLM',
                outcome: 'delayed',
                reasonCode: 'STALE_QUOTE',
                observedLedger: 199,
                quoteAgeSeconds: 601,
            })],
        ])
    })

    it('reports blocked outcomes for a missing quote and an older ledger with accepted context', async () => {
        vi.spyOn(assetRegistryService, 'getSymbols').mockReturnValue(['XLM', 'BTC'])
        vi.spyOn(assetRegistryService, 'getCoingeckoIdMap').mockReturnValue({ XLM: 'stellar', BTC: 'bitcoin' })

        const freshnessWrites = vi.spyOn(store, 'setAssetFreshness')
        // Seed an accepted Reflector quote for XLM at ledger 200.
        expect(store.acceptReflectorQuote({
            asset: 'XLM', source: 'reflector', price: 0.354,
            timestamp: nowSec - 60, ledger: 200,
            maxAgeSeconds: 600, nowMs: nowSec * 1000,
        }).result).toBe('accepted')

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response({
                prices: {
                    // BTC missing entirely; XLM replays an older ledger.
                    XLM: { price: '3600000', decimals: 7, timestamp: nowSec - 601, ledger: 199 },
                },
            }))
            .mockResolvedValueOnce(response({}))
        vi.stubGlobal('fetch', fetchMock)
        service = new ReflectorService()

        await expect(service.getCurrentPrices()).rejects.toThrow('Price sources unavailable')

        const blocked = ingestionCalls(warn).map(([, payload]) => payload)
        expect(blocked).toEqual(expect.arrayContaining([
            expect.objectContaining({
                asset: 'BTC', outcome: 'blocked', reasonCode: 'MISSING_QUOTE', source: 'reflector',
            }),
            expect.objectContaining({
                asset: 'XLM', outcome: 'blocked', reasonCode: 'OLDER_LEDGER',
                observedLedger: 199, acceptedLedger: 200, acceptedPrice: 0.354,
                ageMs: 601000,
            }),
        ]))
        expect(blocked).toHaveLength(2)
        expect(ingestionCalls(info)).toEqual([])
        expect(fetchMock.mock.calls.filter(([url]) => !String(url).includes('coingecko'))).toHaveLength(1)
        expect(freshnessWrites).toHaveBeenCalledTimes(1)
        expect(store.getAcceptedReflectorQuote('XLM')).toMatchObject({
            source: 'reflector',
            price: 0.354,
            ledger: 200,
            timestamp: nowSec - 60,
        })
    })

    it('never leaks provider credentials or URLs into ingestion outcome logs', async () => {
        const reflectorSecret = 'reflector-token-abc123'
        const coingeckoSecret = 'cg-pro-key-xyz789'
        vi.stubEnv('REFLECTOR_API_URL', `https://reflector.example/?key=${reflectorSecret}`)
        vi.stubEnv('COINGECKO_API_KEY', coingeckoSecret)
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(response({
                prices: { XLM: { price: '3540000', decimals: 7, timestamp: nowSec - 601, ledger: 199 } },
            }))
            .mockResolvedValueOnce(response({
                stellar: { usd: 0.361, last_updated_at: nowSec - 3 },
            })))
        service = new ReflectorService()

        await service.getCurrentPrices()

        const entries = [...info.mock.calls, ...warn.mock.calls]
        const serialized = inspect(entries, { depth: null, maxArrayLength: null })
        expect(serialized).not.toContain(reflectorSecret)
        expect(serialized).not.toContain(coingeckoSecret)
        expect(serialized).not.toContain('reflector.example')
        expect(ingestionCalls(warn)).toEqual([
            ['[ORACLE] price_ingestion', expect.objectContaining({
                source: 'reflector', asset: 'XLM', outcome: 'delayed', reasonCode: 'STALE_QUOTE',
            })],
        ])
    })
})
