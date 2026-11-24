import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, ReferenceDot, BarChart, Bar, Cell
} from 'recharts'
import { BarChart3, AlertCircle, TrendingUp, TrendingDown } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'
import { usePortfolioAnalytics, usePerformanceSummary, usePortfolioBenchmark } from '../hooks/queries/useAnalyticsQuery'
import { useRebalanceHistory } from '../hooks/queries/useHistoryQuery'
import { performanceChartCopy, DEFAULT_LOCALE } from '../content/uiCopy'
import { formatUsdCompact, formatPercent } from '../utils/localeFormat'
import { downloadCSV, toCSV } from '../utils/export'


interface PerformanceChartProps {
  portfolioId: string | null
}

interface TimeRangeOption {
  label: string
  /** spoken name, e.g. "1 week" */
  name: string
  days: number
  value: string
}

const TIME_RANGES: TimeRangeOption[] = [
  { label: '1D', name: '1 day', days: 1, value: '1d' },
  { label: '1W', name: '1 week', days: 7, value: '1w' },
  { label: '1M', name: '1 month', days: 30, value: '1m' },
  { label: '3M', name: '3 months', days: 90, value: '3m' },
  { label: 'ALL', name: 'all time', days: 3650, value: 'all' },
]

function formatChartDate(timestamp: string): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return 'Unknown'
  return date.toLocaleDateString(DEFAULT_LOCALE, { month: 'short', day: 'numeric', year: '2-digit' })
}

function formatTooltipDate(timestamp: string): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return 'Unknown date'
  return date.toLocaleDateString(DEFAULT_LOCALE, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatCurrency(value: number): string {
  return formatUsdCompact(value)
}

function formatPercentage(value: number): string {
  return formatPercent(value)
}

interface Refetchable {
  error: unknown
  refetch?: () => Promise<unknown>
}

const PerformanceChart: React.FC<PerformanceChartProps> = ({ portfolioId }) => {
  const [days, setDays] = useState(1)
  const { isDark } = useTheme()
  const selectedRange = TIME_RANGES.find((r) => r.days === days) ?? TIME_RANGES[0]

  const requestedDays = days

  const { from, to } = useMemo(() => {
    const toDate = new Date()
    const fromDate = new Date(toDate.getTime() - requestedDays * 24 * 60 * 60 * 1000)
    return { from: fromDate.toISOString(), to: toDate.toISOString() }
  }, [requestedDays])

  const analyticsQuery = usePortfolioAnalytics(portfolioId, requestedDays)
  const summaryQuery = usePerformanceSummary(portfolioId)
  const historyQuery = useRebalanceHistory(portfolioId, 1, 50)
  const { data: benchmarkResult, isLoading: benchmarkLoading, error: benchmarkError } = usePortfolioBenchmark(portfolioId, from, to)
  const { data: analyticsDataResult, isLoading: analyticsLoading, error: analyticsError } = analyticsQuery
  const { data: summaryDataResult, isLoading: summaryLoading, error: summaryError } = summaryQuery
  const { data: historyResult, isLoading: historyLoading, error: historyError } = historyQuery

  const analyticsData = analyticsDataResult?.data || []
  const performanceSummary = summaryDataResult
  const benchmarks = benchmarkResult?.benchmarks || []

  const isLivePortfolio = !!portfolioId && portfolioId !== 'demo'
  const loading = isLivePortfolio ? !!(analyticsLoading || summaryLoading || historyLoading || benchmarkLoading) : false
  const error = analyticsError || summaryError || historyError ? performanceChartCopy.loadError : null

  // Retry and dismiss state. A ref guards against a second request while one is in flight (double clicks,
  // Enter held down), so recovering never duplicates work.
  const retryInFlight = useRef(false)
  const [retrying, setRetrying] = useState(false)
  const [dismissedMissingKey, setDismissedMissingKey] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const missingBadgeRef = useRef<HTMLButtonElement>(null)
  const missingPanelRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<'heading' | 'badge' | 'panel' | null>(null)

  const retry = useCallback(async (queries: Refetchable[]) => {
    if (retryInFlight.current) return
    const targets = queries.filter((q) => typeof q.refetch === 'function')
    if (targets.length === 0) return
    retryInFlight.current = true
    setRetrying(true)
    try {
      await Promise.all(targets.map((q) => q.refetch!()))
    } catch {
      // the query's own error state reports the failure, and Retry is offered again
    } finally {
      retryInFlight.current = false
      setRetrying(false)
      pendingFocus.current = 'heading'
    }
  }, [])

  const retryFailed = () => retry([analyticsQuery, summaryQuery, historyQuery].filter((q) => q.error))
  const retryPrices = () => retry([analyticsQuery])

  const formatChartData = useMemo(() => {
    return analyticsData.map((snapshot: any) => {
      const value = typeof snapshot.totalValue === 'number' ? snapshot.totalValue : Number(snapshot.totalValue || 0)
      return {
        date: formatChartDate(snapshot.timestamp),
        value: Number.isFinite(value) ? Number(value.toFixed(2)) : 0,
        timestamp: snapshot.timestamp,
        isComplete: isCompleteSnapshot(snapshot),
      }
    })
  }, [analyticsData])



  const exportChartDataCSV = () => {
    const rows = formatChartData.map((dataPoint: { date: string; value: number; timestamp: any }) => ({
      timestamp: dataPoint.timestamp,
      date: dataPoint.date,
      portfolioValue: dataPoint.value,
    }))
    const csv = toCSV(rows, ['timestamp', 'date', 'portfolioValue'])
    const filename = `portfolio_performance_${portfolioId}_${days}d_${new Date().toISOString()}.csv`
    downloadCSV(filename, csv)
  }

  if (!isLivePortfolio) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
          <div className="text-center">
            <BarChart3 className="w-12 h-12 mx-auto mb-2 text-gray-400 dark:text-gray-500" />
            <p>{performanceChartCopy.demoHint}</p>
          </div>
        </div>
      </div>
    )
  }



  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    const data = payload[0].payload
    return (
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 shadow-lg">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
          {formatTooltipDate(data.timestamp)}
        </p>
        <p className="text-sm font-semibold text-gray-900 dark:text-white">
          {formatCurrency(data.value)}
        </p>
      </div>
    )
  }

  const secondaryButton =
    'px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed'

  return (

              aria-label="Export chart data as CSV"
            >
              Export
            </button>
          </div>
        </div>


                      />
                      <YAxis
                        stroke={isDark ? '#9CA3AF' : '#666'}
                        tick={{ fontSize: 12, fill: isDark ? '#9CA3AF' : '#666' }}
                        tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                        width={48}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="#3B82F6"
                        strokeWidth={3}
                        // a single point has no line to draw, so show it as a dot
                        dot={dataState === 'single' ? { r: 5 } : false}
                        name="Portfolio value"
                      />
                      {(historyResult?.history ?? []).map((event: any) => {
                        const eventTimestamp = new Date(event.timestamp).getTime()
                        const bestMatch = chartData.reduce((best: any | null, item: any) => {
                          const itemTimestamp = new Date(item.timestamp).getTime()
                          if (!Number.isFinite(itemTimestamp)) return best
                          if (itemTimestamp > eventTimestamp) return best
                          return !best || itemTimestamp > new Date(best.timestamp).getTime() ? item : best
                        }, null)

                        if (!bestMatch) return null

                        return (
                          <ReferenceDot
                            key={event.id}
                            data-testid="reference-dot"
                            x={bestMatch.date}
                            y={bestMatch.value}
                            r={5}
                            stroke="#fff"
                            strokeWidth={2}
                            fill={event.status === 'failed' ? '#ef4444' : '#f59e0b'}
                            label={{
                              position: 'top',
                              value: event.status === 'failed' ? '⚠' : '●',
                              fill: isDark ? '#F9FAFB' : '#111827',
                              fontSize: 12,
                            }}
                          />
                        )
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">Total Return</span>
              {metrics.totalReturn >= 0 ? (
                <TrendingUp className="w-4 h-4 text-green-500" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-500" />
              )}
            </div>
            <div className={`text-2xl font-bold ${metrics.totalReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatPercentage(metrics.totalReturn)}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">Daily Change</span>
              {metrics.dailyChange >= 0 ? (
                <TrendingUp className="w-4 h-4 text-green-500" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-500" />
              )}
            </div>
            <div className={`text-2xl font-bold ${metrics.dailyChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatPercentage(metrics.dailyChange)}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">Weekly Change</span>
              {metrics.weeklyChange >= 0 ? (
                <TrendingUp className="w-4 h-4 text-green-500" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-500" />
              )}
            </div>
            <div className={`text-2xl font-bold ${metrics.weeklyChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatPercentage(metrics.weeklyChange)}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">Max Drawdown</span>
              <AlertCircle className="w-4 h-4 text-orange-500" />
            </div>
            <div className="text-2xl font-bold text-orange-600">
              {formatPercentage(metrics.maxDrawdown)}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
            <div className="mb-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">Best Day</span>
            </div>
            <div className="text-lg font-semibold text-green-600">
              {formatPercentage(metrics.bestDay.change)}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {metrics.bestDay.date ? new Date(metrics.bestDay.date).toLocaleDateString() : 'N/A'}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
            <div className="mb-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">Worst Day</span>
            </div>
            <div className="text-lg font-semibold text-red-600">
              {formatPercentage(metrics.worstDay.change)}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {metrics.worstDay.date ? new Date(metrics.worstDay.date).toLocaleDateString() : 'N/A'}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
            <div className="mb-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">Sharpe Ratio</span>
            </div>
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {metrics.sharpeRatio.toFixed(2)}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {metrics.sharpeRatio > 1 ? 'Good' : metrics.sharpeRatio > 0 ? 'Fair' : 'Poor'}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
            <div className="mb-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">Volatility</span>
            </div>
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {formatPercentage(metrics.volatility)}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Daily volatility
            </div>
          </div>
        </div>
      )}

      {(benchmarks.length > 0 || !benchmarkLoading) && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm mt-6">
          <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-4">Benchmark Comparison (Alpha)</h3>
          {benchmarks.length > 0 ? (
            <div className="h-64" role="img" aria-label="Benchmark comparison chart showing alpha">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={benchmarks} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#374151' : '#f0f0f0'} />
                  <XAxis dataKey="name" stroke={isDark ? '#9CA3AF' : '#666'} tick={{ fontSize: 12, fill: isDark ? '#9CA3AF' : '#666' }} />
                  <YAxis stroke={isDark ? '#9CA3AF' : '#666'} tick={{ fontSize: 12, fill: isDark ? '#9CA3AF' : '#666' }} tickFormatter={(value) => `${value.toFixed(1)}%`} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: isDark ? '#1F2937' : '#FFFFFF', borderColor: isDark ? '#374151' : '#E5E7EB', borderRadius: '0.5rem' }}
                    itemStyle={{ color: isDark ? '#F9FAFB' : '#111827' }}
                    formatter={(value: any) => [`${Number(value ?? 0).toFixed(2)}%`, 'Alpha']}
                  />
                  <ReferenceDot y={0} stroke="#666" />
                  <Bar dataKey="alpha" radius={[4, 4, 0, 0]}>
                    {benchmarks.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={entry.alpha >= 0 ? '#10B981' : '#EF4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-sm text-gray-500 dark:text-gray-400" role="note">
              <AlertCircle className="w-4 h-4 mt-0.5 text-gray-400 dark:text-gray-500" aria-hidden />
              <p>
                Benchmark data is unavailable for the selected period
                {benchmarkError ? ' (benchmark service is currently unavailable)' : ''} — showing
                portfolio performance only.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default PerformanceChart
