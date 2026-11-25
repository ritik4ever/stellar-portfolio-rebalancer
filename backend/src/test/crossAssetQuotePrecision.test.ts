import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeScaledQuote } from '../utils/quotePrecision.js'
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

const response = (body: unknown, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
})

const nowSec = Date.UTC(2026, 0, 1) / 1000

describe('Cross-asset quote precision boundary (SPR-2026-111)', () => {
    describe('normalizeScaledQuote', () => {
        it('conserves integer token units across different decimal scales', () => {
            const cases = [
                { raw: '3540000', decimals: 7, price: 0.354 },
                { raw: '6100000000000', decimals: 8, price: 61000 },
                { raw: '1000000', decimals: 6, price: 1 },
                { raw: '42', decimals: 0, price: 42 },
            ]
            for (const { raw, decimals, price } of cases) {
                const result = normalizeScaledQuote(raw, decimals)
                // The decimal price reconstructs the exact integer unit count.
                expect(result.price).toBe(price)
                expect(result.units).toBe(raw.replace(/^0+/, ''))
                expect(result.decimals).toBe(decimals)
                expect(Number(`${result.units}e-${decimals}`)).toBe(result.price)
            }
        })

        it('produces a stable result for repeated normalization of the same quote', () => {
            const first = normalizeScaledQuote('3540000', 7)
            const second = normalizeScaledQuote('3540000', 7)
            expect(second).toEqual(first)
        })

        it('rejects invalid scales and non-conserved values deterministically', () => {
            expect(() => normalizeScaledQuote('100', -1)).toThrow(TypeError)
            expect(() => normalizeScaledQuote('100', 39)).toThrow(TypeError)
            expect(() => normalizeScaledQuote('abc', 7)).toThrow(TypeError)
            expect(() => normalizeScaledQuote('-5', 7)).toThrow(TypeError)
            // i128 overflow boundary: max + 1 must throw RangeError.
            expect(() => normalizeScaledQuote('170141183460469231731687303715884105728', 0))
                .toThrow(RangeError)
            expect(normalizeScaledQuote('170141183460469231731687303715884105727', 0).units)
                .toBe('170141183460469231731687303715884105727')
        })
    })

    describe('ReflectorService mixed-scale ingestion', () => {
        let service: ReflectorService
        let info: MockInstance<typeof logger.info>

        beforeEach(() => {
            vi.useFakeTimers()
            vi.setSystemTime(nowSec * 1000)
            vi.stubEnv('REFLECTOR_API_URL', 'https://reflector.example')
            vi.stubEnv('PRICE_DATA_MAX_AGE', '600')
            vi.stubEnv('ALLOW_FALLBACK_PRICES', 'false')
            vi.stubEnv('ORACLE_CACHE_TTL_SECONDS', '0')
            vi.stubEnv('COINGECKO_API_KEY', '')
            vi.spyOn(assetRegistryService, 'getSymbols').mockReturnValue(['XLM', 'BTC'])
            vi.spyOn(assetRegistryService, 'getCoingeckoIdMap').mockReturnValue({ XLM: 'stellar', BTC: 'bitcoin' })
            const directory = mkdtempSync(join(tmpdir(), 'quote-precision-'))
            vi.stubEnv('DB_PATH', join(directory, 'oracle.db'))
            info = vi.spyOn(logger, 'info')
        })

        afterEach(() => {
            service?.stopCacheMetricsReporting()
            vi.useRealTimers()
            vi.unstubAllEnvs()
            vi.unstubAllGlobals()
            vi.restoreAllMocks()
        })

        it('accepts assets at different decimal scales and documents conserved units', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
                prices: {
                    XLM: { price: '3540000', decimals: 7, timestamp: nowSec - 5, ledger: 200 },
                    BTC: { price: '6100000000000', decimals: 8, timestamp: nowSec - 5, ledger: 300 },
                },
            })))
            service = new ReflectorService()

            const prices = await service.getCurrentPrices()

            expect(prices.XLM).toMatchObject({ source: 'reflector', price: 0.354, ledger: 200 })
            expect(prices.BTC).toMatchObject({ source: 'reflector', price: 61000, ledger: 300 })

            // Each accepted decision documents the conserved integer units.
            expect(info).toHaveBeenCalledWith('[ORACLE] price_ingestion', expect.objectContaining({
                asset: 'XLM', outcome: 'success', decimals: 7, units: '3540000',
            }))
            expect(info).toHaveBeenCalledWith('[ORACLE] price_ingestion', expect.objectContaining({
                asset: 'BTC', outcome: 'success', decimals: 8, units: '6100000000000',
            }))
            expect(info).toHaveBeenCalledWith('[ORACLE] quote_precision', expect.objectContaining({
                asset: 'BTC', outcome: 'success', decimals: 8, units: '6100000000000',
            }))
        })
    })
})
