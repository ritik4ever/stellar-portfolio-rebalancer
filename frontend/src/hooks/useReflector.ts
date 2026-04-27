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
