/**
 * @deprecated Use `usePortfolioDetails` from `./queries/usePortfolioQuery` instead.
 *
 * This hook used a manual `useEffect` + `setInterval` polling pattern.
 * It has been replaced by TanStack Query hooks that provide:
 * - Automatic caching & deduplication
 * - Background refetching via `refetchInterval`
 * - Built-in loading/error states
 * - Cache invalidation on mutations
 *
 * Migration:
 * ```ts
 * // Before:
 * const { portfolio, loading, error, executeRebalance } = usePortfolio(id)
 *
 * // After:
 * const { data: portfolio, isLoading, error } = usePortfolioDetails(id)
 * const { mutateAsync: executeRebalance } = useExecuteRebalanceMutation(id)
 * ```
 */

import { useState, useEffect } from 'react'
import { api, ENDPOINTS } from '../config/api'

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
    if (import.meta.env.DEV) {
        console.warn(
            '[usePortfolio] DEPRECATED: Use usePortfolioDetails from ./queries/usePortfolioQuery instead. ' +
            'This hook uses manual polling that duplicates TanStack Query functionality.',
        )
    }

    const [portfolio, setPortfolio] = useState<PortfolioData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!portfolioId) return

        const fetchPortfolio = async () => {
            try {
                setLoading(true)
                const data = await api.get<{ portfolio: PortfolioData }>(ENDPOINTS.PORTFOLIO_DETAIL(portfolioId))
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

        const previousPortfolio = portfolio
        setError(null)
        setPortfolio(prev =>
            prev
                ? {
                      ...prev,
                      needsRebalance: false,
                      lastRebalance: new Date().toISOString(),
                  }
                : prev
        )

        try {
            await api.post(ENDPOINTS.PORTFOLIO_REBALANCE(portfolioId))

            // Refresh portfolio data to invalidate optimistic snapshot
            const data = await api.get<{ portfolio: PortfolioData }>(ENDPOINTS.PORTFOLIO_DETAIL(portfolioId))
            setPortfolio(data.portfolio)
        } catch (err) {
            setPortfolio(previousPortfolio)
            setError(err instanceof Error ? err.message : 'Rebalance failed')
        }
    }

    return { portfolio, loading, error, executeRebalance }
}
