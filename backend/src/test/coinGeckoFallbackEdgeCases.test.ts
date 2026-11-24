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

const isReflector = (url: unknown) => String(url).includes('reflector.example')
const isCoinGecko = (url: unknown) => String(url).includes('api.coingecko.com')

describe('CoinGecko fallback edge cases (SPR-2026-107/108/110)', () => {
    let service: ReflectorService
    let store: DatabaseService
    let directory: string
    let warn: MockInstance<typeof logger.warn>
    let info: MockInstance<typeof logger.info>
    let freshnessSpy: MockInstance<typeof databaseService.setAssetFreshness>

    const fallbackCalls = (spy: MockInstance<any>) =>
        spy.mock.calls.filter(([message]) => message === '[ORACLE] coingecko_fallback')

    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(nowSec * 1000)
        vi.stubEnv('REFLECTOR_API_URL', 'https://reflector.example')
        vi.stubEnv('PRICE_DATA_MAX_AGE', '600')
        vi.stubEnv('ALLOW_FALLBACK_PRICES', 'false')
        vi.stubEnv('ORACLE_CACHE_TTL_SECONDS', '0')
        vi.stubEnv('COINGECKO_API_KEY', '')
        vi.stubEnv('COINGECKO_FALLBACK_CACHE_TTL_MS', '600000')
        vi.spyOn(assetRegistryService, 'getSymbols').mockReturnValue(['XLM', 'BTC'])
        vi.spyOn(assetRegistryService, 'getCoingeckoIdMap').mockReturnValue({ XLM: 'stellar', BTC: 'bitcoin' })
        directory = mkdtempSync(join(tmpdir(), 'coingecko-edges-'))
        vi.stubEnv('DB_PATH', join(directory, 'oracle.db'))
        store = new DatabaseService()
        vi.spyOn(databaseService, 'acceptReflectorQuote').mockImplementation((input) => store.acceptReflectorQuote(input))
        vi.spyOn(databaseService, 'getAcceptedReflectorQuote').mockImplementation((symbol) => store.getAcceptedReflectorQuote(symbol))
        freshnessSpy = vi.spyOn(databaseService, 'setAssetFreshness')
            .mockImplementation((symbol, refreshed, quarantined) => store.setAssetFreshness(symbol, refreshed, quarantined))
        warn = vi.spyOn(logger, 'warn')
        info = vi.spyOn(logger, 'info')
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

    it('serves a missing Reflector quote from CoinGecko with clear provenance and no duplicate side effects', async () => {
        // Reflector only reports BTC; XLM is missing entirely.
        const fetchMock = vi.fn(async (url: unknown) => {
            if (isReflector(url)) {
                return response({
                    prices: { BTC: { price: '6100000000000', decimals: 8, timestamp: nowSec - 5, ledger: 300 } },
                })
            }
            if (isCoinGecko(url)) {
                return response({
                    stellar: { usd: 0.36, usd_24h_change: 0.4, last_updated_at: nowSec - 2 },
                })
            }
            throw new Error(`unexpected url ${String(url)}`)
        })
        vi.stubGlobal('fetch', fetchMock)
        service = new ReflectorService()

        const prices = await service.getCurrentPrices()

        // Provenance: BTC stays on the Reflector ledger, XLM is CoinGecko-sourced.
        expect(prices.BTC).toMatchObject({ source: 'reflector', price: 61000, ledger: 300 })
        expect(prices.XLM).toMatchObject({ source: 'coingecko_free', price: 0.36 })
        expect(store.getAcceptedReflectorQuote('BTC')).toMatchObject({ source: 'reflector', ledger: 300 })
        expect(store.getAcceptedReflectorQuote('XLM')).toBeUndefined()

        const coingeckoCalls = fetchMock.mock.calls.filter(([url]) => isCoinGecko(url))
        expect(coingeckoCalls).toHaveLength(1)
        expect(String(coingeckoCalls[0]?.[0])).toContain('stellar')
        expect(String(coingeckoCalls[0]?.[0])).not.toContain('bitcoin')

        expect(fallbackCalls(warn)).toEqual([])
        expect(info).toHaveBeenCalledWith('[ORACLE] coingecko_fallback', expect.objectContaining({
            source: 'coingecko_free', outcome: 'success', reason: 'fetched', asset: 'XLM',
        }))
        expect(freshnessSpy.mock.calls.filter(([symbol]) => symbol === 'XLM')).toHaveLength(1)

        // A second request hits the fallback cache: no duplicate CoinGecko call,
        // no repeated freshness write.
        vi.advanceTimersByTime(91_000) // past the CoinGecko rate-limit window
        await service.getCurrentPrices()
        expect(fetchMock.mock.calls.filter(([url]) => isCoinGecko(url))).toHaveLength(1)
        expect(freshnessSpy.mock.calls.filter(([symbol]) => symbol === 'XLM')).toHaveLength(1)
        service.stopCacheMetricsReporting()
    })

    it('explicitly stops a fallback quote disagreeing beyond tolerance without duplicate side effects', async () => {
        // XLM has a stale Reflector quote (reference price 0.10); BTC is missing.
        const fetchMock = vi.fn(async (url: unknown) => {
            if (isReflector(url)) {
                return response({
                    prices: {
                        XLM: { price: '1000000', decimals: 7, timestamp: nowSec - 601, ledger: 199 },
                    },
                })
            }
            if (isCoinGecko(url)) {
                return response({
                    stellar: { usd: 0.2, last_updated_at: nowSec - 2 },   // 5000 bps off
                    bitcoin: { usd: 61000, last_updated_at: nowSec - 2 },
                })
            }
            throw new Error(`unexpected url ${String(url)}`)
        })
        vi.stubGlobal('fetch', fetchMock)
        service = new ReflectorService()

        // BTC merges from CoinGecko; XLM is dropped by the disagreement stop,
        // so the result is a partial map without XLM.
        const prices = await service.getCurrentPrices()
        expect(prices.BTC).toMatchObject({ source: 'coingecko_free', price: 61000 })
        expect(prices.XLM).toBeUndefined()

        // Explicit rejection reason with full diagnostic context.
        expect(warn).toHaveBeenCalledWith('[ORACLE] coingecko_fallback', expect.objectContaining({
            source: 'coingecko_free', outcome: 'blocked', reason: 'price_disagreement',
            asset: 'XLM', deviationBps: 5000, toleranceBps: 300,
        }))
        expect(warn).not.toHaveBeenCalledWith('[ORACLE] coingecko_fallback', expect.objectContaining({
            reason: 'fetched', asset: 'XLM',
        }))

        // The disagreeing quote left no persisted or cached trace.
        expect(store.getAcceptedReflectorQuote('XLM')).toBeUndefined()
        expect(freshnessSpy.mock.calls.filter(([symbol]) => symbol === 'XLM')).toHaveLength(0)

        // A retry re-evaluates the quote: the rejected entry was never cached,
        // so CoinGecko is asked again and the decision is recomputed.
        vi.advanceTimersByTime(91_000) // past the CoinGecko rate-limit window
        const retry = await service.getCurrentPrices()
        expect(retry.XLM).toBeUndefined()
        expect(fetchMock.mock.calls.filter(([url]) => isCoinGecko(url))).toHaveLength(2)
        expect(freshnessSpy.mock.calls.filter(([symbol]) => symbol === 'BTC')).toHaveLength(2)
        expect(freshnessSpy.mock.calls.filter(([symbol]) => symbol === 'XLM')).toHaveLength(0)
    })
})
