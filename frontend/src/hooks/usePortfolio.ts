import { useState, useEffect } from 'react'

interface PortfolioData {
    id: string
    totalValue: number
    allocations: Array<{
        asset: string
        target: number
        current: number
        amount: number
    }>
    needsRebalance: boolean
    lastRebalance: string
}

export const usePortfolio = (portfolioId?: string) => {
    const [portfolio, setPortfolio] = useState<PortfolioData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!portfolioId) return

        const fetchPortfolio = async () => {
            try {
                setLoading(true)
                const response = await fetch(`/api/portfolio/${portfolioId}`)
                if (!response.ok) throw new Error('Failed to fetch portfolio')

                const data = await response.json()
                setPortfolio(data.portfolio)
                setError(null)
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Unknown error')
            } finally {
                setLoading(false)
            }
        }

        fetchPortfolio()

        // Set up polling for real-time updates
        const interval = setInterval(fetchPortfolio, 30000)
        return () => clearInterval(interval)
    }, [portfolioId])

    const executeRebalance = async () => {
        if (!portfolioId) return

        try {
            const response = await fetch(`/api/portfolio/${portfolioId}/rebalance`, {
                method: 'POST'
            })
            if (!response.ok) throw new Error('Rebalance failed')

            // Refresh portfolio data
            const portfolioResponse = await fetch(`/api/portfolio/${portfolioId}`)
            const data = await portfolioResponse.json()
            setPortfolio(data.portfolio)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Rebalance failed')
        }
    }

    return { portfolio, loading, error, executeRebalance }
}