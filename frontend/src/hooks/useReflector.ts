import { useState, useEffect } from 'react'

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
                const response = await fetch('/api/prices')
                if (!response.ok) throw new Error('Failed to fetch prices')

                const data = await response.json()
                setPrices(data)
                setError(null)
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to fetch prices')
            } finally {
                setLoading(false)
            }
        }

        fetchPrices()

        // Update prices every 30 seconds
        const interval = setInterval(fetchPrices, 30000)
        return () => clearInterval(interval)
    }, [])

    return { prices, loading, error }
}