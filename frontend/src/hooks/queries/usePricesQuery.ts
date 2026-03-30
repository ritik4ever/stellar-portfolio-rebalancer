import { useQuery } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../../config/api'

export const priceKeys = {
    all: ['prices'] as const,
}

export type PriceFeedClientMeta = {
    provider: 'backend' | 'browser'
    resolvedAtMs: number
    degraded: boolean
    staleOrLimited: boolean
    resolutionHint: string
    assetsCount: number
}

export type PricesQueryData = {
    prices: Record<string, unknown>
    feedMeta?: PriceFeedClientMeta
}

export function unwrapPriceFeedPayload(raw: unknown): PricesQueryData {
    if (raw && typeof raw === 'object' && 'prices' in raw) {
        const o = raw as { prices: unknown; feedMeta?: PriceFeedClientMeta }
        if (o.prices && typeof o.prices === 'object' && !Array.isArray(o.prices)) {
            return { prices: o.prices as Record<string, unknown>, feedMeta: o.feedMeta }
        }
    }
    return { prices: (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown> }
}

export function formatPriceFeedSummary(
    meta: PriceFeedClientMeta | undefined,
    hasPriceRows: boolean,
    isDemoFallback: boolean
): string {
    if (isDemoFallback && !hasPriceRows) return 'Demo data'
    if (!hasPriceRows) return '—'
    if (!meta) return 'Price feed'
    if (meta.degraded) {
        return meta.provider === 'browser' ? 'Browser synthetic fallback' : 'Server synthetic fallback'
    }
    const loc = meta.provider === 'browser' ? 'Browser' : 'Server'
    switch (meta.resolutionHint) {
        case 'fresh_primary':
            return `${loc} live (CoinGecko)`
        case 'cached_only':
            return `${loc} cached quotes`
        case 'partial_merge':
            return `${loc} mixed cache and live`
        case 'rate_limited_cache':
            return `${loc} cache only (rate limited)`
        case 'error_recovery_cache':
            return `${loc} stale cache after API error`
        case 'synthetic_fallback':
            return `${loc} synthetic fallback`
        default:
            return `${loc} quotes`
    }
}

export const usePrices = () => {
    return useQuery({
        queryKey: priceKeys.all,
        queryFn: async () => {
            const raw = await api.get<unknown>(ENDPOINTS.PRICES)
            return unwrapPriceFeedPayload(raw)
        },
        refetchInterval: 60000,
        staleTime: 55000,
    })
}
