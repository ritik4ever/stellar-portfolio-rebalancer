/**
 * @deprecated Use `usePrices` from `./queries/usePricesQuery` instead.
 *
 * This hook used a manual `useEffect` + `setInterval` polling pattern.
 * It has been replaced by TanStack Query hooks that provide:
 * - Automatic caching & deduplication
 * - Background refetching via `refetchInterval`
 * - Built-in loading/error states
 *
 * Migration:
 * ```ts
 * // Before:
 * const { prices, loading, error } = useReflector()
 *
 * // After:
 * const { data: priceBundle, isLoading, error } = usePrices()
 * const prices = priceBundle?.prices ?? {}
 * ```
 */

import { useState, useEffect } from 'react'
import { api, ENDPOINTS } from '../config/api'
import { unwrapPriceFeedPayload } from './queries/usePricesQuery'

interface PriceData {
    [asset: string]: {
        price: number
        change: number
        timestamp: number
    }
}

export const useReflector = () => {
    if (import.meta.env.DEV) {
        console.warn(
            '[useReflector] DEPRECATED: Use usePrices from ./queries/usePricesQuery instead. ' +
            'This hook uses manual polling that duplicates TanStack Query functionality.',
        )
    }

    const [prices, setPrices] = useState<PriceData>({})
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const fetchPrices = async () => {
            try {
                const raw = await api.get<unknown>(ENDPOINTS.PRICES)
                const { prices: row } = unwrapPriceFeedPayload(raw)
                setPrices(row as PriceData)
                setError(null)
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to fetch prices')
            } finally {
                setLoading(false)
            }
        }

        fetchPrices()

        const interval = setInterval(fetchPrices, 30000)
        return () => clearInterval(interval)
    }, [])

    return { prices, loading, error }
}
