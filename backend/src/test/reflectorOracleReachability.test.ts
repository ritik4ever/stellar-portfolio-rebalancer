/**
 * Reflector oracle reachability probe (#1405).
 *
 * Covers each failure mode the startup self-test needs to tell apart:
 * unconfigured, unreachable, timeout, HTTP error, missing data, stale quote.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../services/assetRegistryService.js', () => ({
    assetRegistryService: {
        getSymbols: vi.fn(() => ['XLM', 'USDC']),
        getCoingeckoIdMap: vi.fn(() => ({})),
    },
}))

vi.mock('../services/databaseService.js', () => ({
    databaseService: {
        setAssetFreshness: vi.fn(),
        getLatestPriceSnapshot: vi.fn(),
    },
}))

vi.mock('../observability/metrics.js', () => ({
    recordCacheTtl: vi.fn(),
    recordPriceFeedResolution: vi.fn(),
    recordReflectorFallbackUsage: vi.fn(),
    recordReflectorStalePrice: vi.fn(),
    recordCacheOperation: vi.fn(),
    recordCacheExpiration: vi.fn(),
    recordCacheAge: vi.fn(),
    recordCacheHitRatio: vi.fn(),
    recordCacheSize: vi.fn(),
    recordCacheEntries: vi.fn(),
}))

const ORACLE_URL = 'https://oracle.example.test'
const ORIGINAL_ENV = { ...process.env }

function freshQuote(asset = 'XLM') {
    return {
        prices: {
            [asset]: {
                price: '4500000',
                decimals: 7,
                timestamp: Math.floor(Date.now() / 1000),
            },
        },
    }
}

async function makeService() {
    const { ReflectorService } = await import('../services/reflector.js')
    return new ReflectorService()
}

describe('ReflectorService.testOracleReachability', () => {
    beforeEach(() => {
        vi.resetModules()
        process.env.REFLECTOR_API_URL = ORACLE_URL
        process.env.PRICE_DATA_MAX_AGE = '600'
        process.env.NODE_ENV = 'test'
    })

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV }
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('reports ok with latency when the oracle returns a fresh quote', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => freshQuote(),
        })
        vi.stubGlobal('fetch', fetchMock)

        const result = await (await makeService()).testOracleReachability()

        expect(result).toMatchObject({ reachable: true, reason: 'ok', asset: 'XLM', httpStatus: 200 })
        expect(result.latencyMs).toBeGreaterThanOrEqual(0)
        expect(fetchMock).toHaveBeenCalledWith(
            `${ORACLE_URL}/prices?assets=XLM`,
            expect.objectContaining({ method: 'GET' }),
        )
    })

    it('is read-only — it issues a GET and sends no body', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => freshQuote(),
        })
        vi.stubGlobal('fetch', fetchMock)

        await (await makeService()).testOracleReachability()

        const [, init] = fetchMock.mock.calls[0]
        expect(init.method).toBe('GET')
        expect(init).not.toHaveProperty('body')
    })

    it('reports not_configured when REFLECTOR_API_URL is unset', async () => {
        delete process.env.REFLECTOR_API_URL
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        const result = await (await makeService()).testOracleReachability()

        expect(result).toMatchObject({ reachable: false, reason: 'not_configured' })
        expect(result.error).toContain('REFLECTOR_API_URL')
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('reports unreachable when the request fails outright', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')))

        const result = await (await makeService()).testOracleReachability()

        expect(result).toMatchObject({ reachable: false, reason: 'unreachable' })
        expect(result.error).toContain('ENOTFOUND')
    })

    it('reports timeout when the request is aborted', async () => {
        const abortError = new Error('The operation was aborted')
        abortError.name = 'AbortError'
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))

        const result = await (await makeService()).testOracleReachability({ timeoutMs: 25 })

        expect(result).toMatchObject({ reachable: false, reason: 'timeout' })
        expect(result.error).toContain('25ms')
    })

    it('reports http_error on a non-2xx response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 503,
            json: async () => ({}),
        }))

        const result = await (await makeService()).testOracleReachability()

        expect(result).toMatchObject({ reachable: false, reason: 'http_error', httpStatus: 503 })
    })

    it('reports no_data when the oracle omits the probed asset', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ prices: {} }),
        }))

        const result = await (await makeService()).testOracleReachability()

        expect(result).toMatchObject({ reachable: false, reason: 'no_data' })
        expect(result.error).toContain('XLM')
    })

    it('reports stale — reachable but not usable — for an old quote', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                prices: {
                    XLM: {
                        price: '4500000',
                        decimals: 7,
                        timestamp: Math.floor(Date.now() / 1000) - 5000,
                    },
                },
            }),
        }))

        const result = await (await makeService()).testOracleReachability()

        expect(result.reachable).toBe(true)
        expect(result.reason).toBe('stale')
        expect(result.error).toContain('older than')
    })

    it('accepts a bare price map without a `prices` wrapper', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                XLM: { price: 0.45, timestamp: Math.floor(Date.now() / 1000) },
            }),
        }))

        const result = await (await makeService()).testOracleReachability()

        expect(result.reason).toBe('ok')
    })

    it('probes the requested asset when one is given', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => freshQuote('USDC'),
        })
        vi.stubGlobal('fetch', fetchMock)

        const result = await (await makeService()).testOracleReachability({ asset: 'USDC' })

        expect(result).toMatchObject({ asset: 'USDC', reason: 'ok' })
        expect(fetchMock.mock.calls[0][0]).toContain('assets=USDC')
    })
})
