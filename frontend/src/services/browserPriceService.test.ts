import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { browserPriceService } from './browserPriceService'

describe('browserPriceService', () => {
  beforeEach(() => {
    browserPriceService.clearCache()
    vi.stubGlobal('fetch', vi.fn())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('fetches prices from Reflector (primary source) correctly', async () => {
    const mockReflectorData = {
      prices: {
        XLM: { price: 0.12, change: 1.5, timestamp: Date.now() / 1000 }
      }
    }

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockReflectorData,
    } as Response)

    const result = await browserPriceService.getCurrentPrices()

    expect(result.prices.XLM.price).toBe(0.12)
    expect(result.prices.XLM.source).toBe('reflector')
    expect(result.feedMeta.resolutionHint).toBe('fresh_primary')
    expect(result.feedMeta.degraded).toBe(false)
  })

  it('falls back to CoinGecko when Reflector fails', async () => {
    // Reflector fails
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response)

    // CoinGecko succeeds
    const mockCoinGeckoData = {
      stellar: { usd: 0.13, usd_24h_change: 2.1, last_updated_at: Date.now() / 1000 }
    }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockCoinGeckoData,
    } as Response)

    const result = await browserPriceService.getCurrentPrices()

    expect(result.prices.XLM.price).toBe(0.13)
    expect(result.prices.XLM.source).toBe('coingecko_browser')
    expect(result.feedMeta.resolutionHint).toBe('fresh_primary')
  })

  it('uses synthetic fallback when both Reflector and CoinGecko fail', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response)

    const result = await browserPriceService.getCurrentPrices()

    expect(result.prices.XLM.source).toBe('fallback_browser')
    expect(result.feedMeta.resolutionHint).toBe('synthetic_fallback')
    expect(result.feedMeta.degraded).toBe(true)
  })

  it('re-fetches fresh data after cache TTL expires', async () => {
    const mockData1 = { prices: { XLM: { price: 0.10, timestamp: Date.now() / 1000 } } }
    const mockData2 = { prices: { XLM: { price: 0.11, timestamp: Date.now() / 1000 } } }

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData1,
    } as Response)

    // First fetch
    await browserPriceService.getCurrentPrices()
    
    // Second fetch (should be from cache)
    const resultCached = await browserPriceService.getCurrentPrices()
    expect(resultCached.feedMeta.resolutionHint).toBe('cached_only')
    expect(fetch).toHaveBeenCalledTimes(1)

    // Advance time past TTL (60s)
    vi.advanceTimersByTime(61000)

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData2,
    } as Response)

    // Third fetch (should be fresh)
    const resultFresh = await browserPriceService.getCurrentPrices()
    expect(resultFresh.prices.XLM.price).toBe(0.11)
    expect(resultFresh.feedMeta.resolutionHint).toBe('fresh_primary')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('serves stale cache when fetch fails and cache exists', async () => {
    const mockData = { prices: { XLM: { price: 0.10, timestamp: Date.now() / 1000 } } }
    
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    } as Response)

    // Initial success
    await browserPriceService.getCurrentPrices()

    // Advance time past TTL
    vi.advanceTimersByTime(61000)

    // Fetch fails
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response)

    const result = await browserPriceService.getCurrentPrices()
    
    expect(result.prices.XLM.price).toBe(0.10)
    expect(result.feedMeta.resolutionHint).toBe('error_recovery_cache')
    expect(result.feedMeta.staleOrLimited).toBe(true)
  })
})
