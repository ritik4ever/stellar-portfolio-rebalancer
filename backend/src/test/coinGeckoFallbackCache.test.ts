import { describe, expect, it } from 'vitest'
import { CoinGeckoFallbackCache, readCoinGeckoFallbackTtlMs } from '../services/coinGeckoFallbackCache.js'

describe('CoinGeckoFallbackCache', () => {
    it('returns every asset only while the short TTL still holds', () => {
        const cache = new CoinGeckoFallbackCache<{ price: number }>(30_000)
        cache.put('XLM', { price: 0.36 }, 1_000)
        cache.put('BTC', { price: 100 }, 1_000)

        expect(cache.getAll(['XLM', 'BTC'], 30_999)?.XLM.price).toBe(0.36)
        expect(cache.getAll(['XLM', 'BTC'], 31_000)).toBeUndefined()
        expect(cache.getAll(['ETH'], 1_500)).toBeUndefined()
    })

    it('defaults a missing TTL to 30 seconds', () => {
        expect(readCoinGeckoFallbackTtlMs(undefined)).toBe(30_000)
        expect(readCoinGeckoFallbackTtlMs('0')).toBe(30_000)
        expect(readCoinGeckoFallbackTtlMs('15000')).toBe(15_000)
    })
})
