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
