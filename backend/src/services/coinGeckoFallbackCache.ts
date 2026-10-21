/**
 * Short-lived cache that sits only in front of the CoinGecko fallback.
 * Reflector quotes never enter this map.
 */
export class CoinGeckoFallbackCache<T> {
    private readonly entries = new Map<string, { data: T; cachedAtMs: number }>()

    constructor(private readonly ttlMs: number) {}

    /** Every requested asset is fresh, or the caller must hit CoinGecko. */
    getAll(assets: string[], now: number): Record<string, T> | undefined {
        if (assets.length === 0) return undefined
        const out: Record<string, T> = {}
        for (const asset of assets) {
            const hit = this.entries.get(asset)
            if (!hit || now - hit.cachedAtMs >= this.ttlMs) {
                if (hit) this.entries.delete(asset)
                return undefined
            }
            out[asset] = hit.data
        }
        return out
    }

    put(asset: string, data: T, now: number): void {
        this.entries.set(asset, { data, cachedAtMs: now })
    }

    clear(): void {
        this.entries.clear()
    }
}

/** Default 30s. A non-positive or non-numeric value falls back to that default. */
export function readCoinGeckoFallbackTtlMs(raw = process.env.COINGECKO_FALLBACK_CACHE_TTL_MS): number {
    const parsed = Number.parseInt(raw ?? '', 10)
    if (!Number.isFinite(parsed) || parsed < 1000) return 30_000
    return parsed
}
