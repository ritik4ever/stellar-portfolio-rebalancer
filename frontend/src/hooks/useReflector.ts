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

export const REFLECTOR_POLL_INTERVAL_MS = 30000
export const PRICE_STALENESS_THRESHOLD_MS = 60000

type ReflectorLikePayload = {
    prices?: PriceData
}

async function fetchReflectorPrices(signal: AbortSignal): Promise<PriceData> {
    const res = await fetch('https://reflector.stellar.org/v1/prices', { signal })
    if (!res.ok) throw new Error(`Reflector fetch failed: ${res.status}`)
    const payload = (await res.json()) as ReflectorLikePayload | PriceData
    const row = unwrapPriceFeedPayload(payload).prices
    return row as PriceData
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
    const [isStale, setIsStale] = useState(false)

    useEffect(() => {
        let isActive = true
        let inFlightController: AbortController | null = null

        const fetchPrices = async () => {
            inFlightController?.abort()
            inFlightController = new AbortController()
            try {
                let row: PriceData
                try {
                    row = await fetchReflectorPrices(inFlightController.signal)
                } catch {
                    const raw = await api.get<unknown>(ENDPOINTS.PRICES)
                    const backend = unwrapPriceFeedPayload(raw).prices
                    row = backend as PriceData
                }

                if (!isActive) return
                setPrices(row)
                const now = Date.now()
                const hasStalePrice = Object.values(row).some(
                    quote => now - Number(quote?.timestamp ?? 0) > PRICE_STALENESS_THRESHOLD_MS
                )
                setIsStale(hasStalePrice)
                setError(null)
            } catch (err) {
                if (!isActive) return
                setError(err instanceof Error ? err.message : 'Failed to fetch prices')
            } finally {
                if (!isActive) return
                setLoading(false)
            }
        }

        fetchPrices()

        const interval = setInterval(fetchPrices, REFLECTOR_POLL_INTERVAL_MS)
        return () => {
            isActive = false
            inFlightController?.abort()
            clearInterval(interval)
        }
    }, [])

    return { prices, loading, error, isStale }
}
