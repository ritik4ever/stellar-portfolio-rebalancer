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

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ENDPOINTS, downloadPortfolioExport } from '../config/api'
import {
    downloadCSV,
    downloadJSON,
    idleExportProgress,
    runExportWithProgress,
    toCSV,
    type ExportProgressState,
} from '../utils/export'

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

export type PortfolioExportClientPayload = {
    rows: Record<string, unknown>[]
    csvHeaders: string[]
    filenameBase: string
    jsonPayload: unknown
}

export function usePortfolioExport() {
    const [exportProgress, setExportProgress] = useState<ExportProgressState>(idleExportProgress())
    const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const clearDismissTimer = () => {
        if (dismissTimer.current) {
            clearTimeout(dismissTimer.current)
            dismissTimer.current = null
        }
    }

    const resetExportProgress = useCallback(() => {
        clearDismissTimer()
        setExportProgress(idleExportProgress())
    }, [])

    const scheduleIdle = useCallback(() => {
        clearDismissTimer()
        dismissTimer.current = setTimeout(() => {
            setExportProgress(idleExportProgress())
        }, 4000)
    }, [])

    useEffect(() => () => clearDismissTimer(), [])

    const exportClientCsv = useCallback(
        async (payload: PortfolioExportClientPayload) => {
            try {
                await runExportWithProgress(
                    {
                        preparing: 'Preparing CSV export…',
                        downloading: 'Building spreadsheet…',
                        complete: 'CSV download started',
                    },
                    setExportProgress,
                    async () => {
                        const csv = toCSV(payload.rows, payload.csvHeaders)
                        const filename = `${payload.filenameBase}.csv`
                        downloadCSV(filename, csv)
                    },
                )
                scheduleIdle()
            } catch {
                scheduleIdle()
            }
        },
        [scheduleIdle],
    )

    const exportClientJson = useCallback(
        async (payload: PortfolioExportClientPayload) => {
            try {
                await runExportWithProgress(
                    {
                        preparing: 'Preparing JSON export…',
                        downloading: 'Serializing portfolio…',
                        complete: 'JSON download started',
                    },
                    setExportProgress,
                    async () => {
                        const filename = `${payload.filenameBase}.json`
                        downloadJSON(filename, payload.jsonPayload)
                    },
                )
                scheduleIdle()
            } catch {
                scheduleIdle()
            }
        },
        [scheduleIdle],
    )

    const exportFromServer = useCallback(
        async (portfolioId: string, format: 'json' | 'csv' | 'pdf') => {
            const formatLabel = format.toUpperCase()
            try {
                await runExportWithProgress(
                    {
                        preparing: `Requesting ${formatLabel} export…`,
                        downloading: `Downloading ${formatLabel} file…`,
                        complete: `${formatLabel} export ready`,
                    },
                    setExportProgress,
                    async () => {
                        await downloadPortfolioExport(portfolioId, format)
                    },
                )
                scheduleIdle()
            } catch {
                scheduleIdle()
            }
        },
        [scheduleIdle],
    )

    return {
        exportProgress,
        resetExportProgress,
        exportClientCsv,
        exportClientJson,
        exportFromServer,
    }
}
