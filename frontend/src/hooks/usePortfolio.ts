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
import { debugLog } from '../utils/debug'

export interface PortfolioSetupDraftAllocation {
  asset: string
  percentage: number
}

export interface PortfolioSetupDraft {
  allocations: PortfolioSetupDraftAllocation[]
  threshold: number
  slippageTolerance: number
  strategy: string
  strategyConfig: Record<string, number>
  autoRebalance: boolean
  selectedTemplateId: string
  savedAt: string
}

export type PortfolioSetupDraftLoadResult =
  | { status: 'empty' }
  | { status: 'loaded'; draft: PortfolioSetupDraft }
  | { status: 'failed'; error: string }

export type PortfolioSetupDraftWriteResult =
  | { status: 'saved' }
  | { status: 'cleared' }
  | { status: 'failed'; error: string }

export const PORTFOLIO_SETUP_DRAFT_VERSION = 1
export const PORTFOLIO_SETUP_DRAFT_KEY = (userId: string | null | undefined) =>
  `portfolio-setup-draft-v${PORTFOLIO_SETUP_DRAFT_VERSION}-${userId || 'anonymous'}`

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function validatePortfolioSetupDraft(
  value: unknown,
): PortfolioSetupDraft | null {
  if (!value || typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  if (!Array.isArray(record.allocations) || record.allocations.length === 0)
    return null

  const allocations = record.allocations.map((allocation) => {
    if (!allocation || typeof allocation !== 'object') return null
    const allocationRecord = allocation as Record<string, unknown>
    if (
      typeof allocationRecord.asset !== 'string' ||
      !isFiniteNumber(allocationRecord.percentage)
    ) {
      return null
    }
    return {
      asset: allocationRecord.asset,
      percentage: allocationRecord.percentage,
    }
  })

  if (allocations.some((allocation) => allocation === null)) return null
  if (
    !isFiniteNumber(record.threshold) ||
    !isFiniteNumber(record.slippageTolerance)
  )
    return null
  if (
    typeof record.strategy !== 'string' ||
    typeof record.selectedTemplateId !== 'string'
  )
    return null
  if (typeof record.autoRebalance !== 'boolean') return null
  if (
    !record.strategyConfig ||
    typeof record.strategyConfig !== 'object' ||
    Array.isArray(record.strategyConfig)
  ) {
    return null
  }

  const strategyConfig = Object.fromEntries(
    Object.entries(record.strategyConfig as Record<string, unknown>).filter(
      ([, configValue]) => isFiniteNumber(configValue),
    ),
  ) as Record<string, number>

  return {
    allocations: allocations as PortfolioSetupDraftAllocation[],
    threshold: record.threshold,
    slippageTolerance: record.slippageTolerance,
    strategy: record.strategy,
    strategyConfig,
    autoRebalance: record.autoRebalance,
    selectedTemplateId: record.selectedTemplateId,
    savedAt:
      typeof record.savedAt === 'string'
        ? record.savedAt
        : new Date().toISOString(),
  }
}

export function loadPortfolioSetupDraft(
  userId?: string | null,
): PortfolioSetupDraftLoadResult {
  try {
    const raw = window.localStorage.getItem(PORTFOLIO_SETUP_DRAFT_KEY(userId))
    if (!raw) return { status: 'empty' }

    const draft = validatePortfolioSetupDraft(JSON.parse(raw))
    if (!draft) {
      return {
        status: 'failed',
        error: 'Saved portfolio draft is no longer readable.',
      }
    }

    return { status: 'loaded', draft }
  } catch (error) {
    debugLog('[portfolio-draft] Failed to load local draft', error)
    return {
      status: 'failed',
      error:
        error instanceof Error
          ? error.message
          : 'Unable to read saved portfolio draft.',
    }
  }
}

export function savePortfolioSetupDraft(
  userId: string | null | undefined,
  draft: Omit<PortfolioSetupDraft, 'savedAt'>,
): PortfolioSetupDraftWriteResult {
  try {
    window.localStorage.setItem(
      PORTFOLIO_SETUP_DRAFT_KEY(userId),
      JSON.stringify({ ...draft, savedAt: new Date().toISOString() }),
    )
    return { status: 'saved' }
  } catch (error) {
    debugLog('[portfolio-draft] Failed to save local draft', error)
    return {
      status: 'failed',
      error:
        error instanceof Error
          ? error.message
          : 'Unable to save portfolio draft locally.',
    }
  }
}

export function clearPortfolioSetupDraft(
  userId?: string | null,
): PortfolioSetupDraftWriteResult {
  try {
    window.localStorage.removeItem(PORTFOLIO_SETUP_DRAFT_KEY(userId))
    return { status: 'cleared' }
  } catch (error) {
    debugLog('[portfolio-draft] Failed to clear local draft', error)
    return {
      status: 'failed',
      error:
        error instanceof Error
          ? error.message
          : 'Unable to clear portfolio draft.',
    }
  }
}

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
        const data = await api.get<{ portfolio: PortfolioData }>(
          ENDPOINTS.PORTFOLIO_DETAIL(portfolioId),
        )
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
    setPortfolio((prev) =>
      prev
        ? {
            ...prev,
            needsRebalance: false,
            lastRebalance: new Date().toISOString(),
          }
        : prev,
    )

    try {
      await api.post(ENDPOINTS.PORTFOLIO_REBALANCE(portfolioId))

      // Refresh portfolio data to invalidate optimistic snapshot
      const data = await api.get<{ portfolio: PortfolioData }>(
        ENDPOINTS.PORTFOLIO_DETAIL(portfolioId),
      )
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
