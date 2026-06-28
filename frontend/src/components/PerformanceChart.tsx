import React, { useState, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, ReferenceDot,
} from 'recharts'
import { BarChart3, AlertCircle, TrendingUp, TrendingDown } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'
import { usePortfolioAnalytics, usePerformanceSummary } from '../hooks/queries/useAnalyticsQuery'
import { useRebalanceHistory } from '../hooks/queries/useHistoryQuery'
import { performanceChartCopy, DEFAULT_LOCALE } from '../content/uiCopy'
import { formatUsdCompact, formatPercent } from '../utils/localeFormat'
import { downloadCSV, toCSV } from '../utils/export'

interface PerformanceChartProps {
  portfolioId: string | null
}

interface TimeRangeOption {
  label: string
  days: number
  value: string
}

const TIME_RANGES: TimeRangeOption[] = [
  { label: '1D', days: 1, value: '1d' },
  { label: '1W', days: 7, value: '1w' },
  { label: '1M', days: 30, value: '1m' },
  { label: '3M', days: 90, value: '3m' },
  { label: 'ALL', days: 3650, value: 'all' },
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

const PerformanceChart: React.FC<PerformanceChartProps> = ({ portfolioId }) => {
  const [days, setDays] = useState(1)
  const { isDark } = useTheme()

  const requestedDays = days

  const { data: analyticsDataResult, isLoading: analyticsLoading, error: analyticsError } = usePortfolioAnalytics(portfolioId, requestedDays)
  const { data: summaryDataResult, isLoading: summaryLoading, error: summaryError } = usePerformanceSummary(portfolioId)
  const { data: historyResult, isLoading: historyLoading, error: historyError } = useRebalanceHistory(portfolioId, 1, 50)

  const analyticsData = analyticsDataResult?.data || []
  const performanceSummary = summaryDataResult
  const loading = portfolioId && portfolioId !== 'demo' ? (analyticsLoading || summaryLoading || historyLoading) : false
  const error = analyticsError || summaryError || historyError ? 'Failed to load performance data' : null

  const formatChartData = useMemo(() => {
    return analyticsData.map((snapshot: any) => {
      const value = typeof snapshot.totalValue === 'number' ? snapshot.totalValue : Number(snapshot.totalValue || 0)
      return {
        date: formatChartDate(snapshot.timestamp),
        value: Number.isFinite(value) ? Number(value.toFixed(2)) : 0,
        timestamp: snapshot.timestamp,
      }
    })
  }, [analyticsData])

  const exportChartDataCSV = () => {
    const rows = formatChartData.map((dataPoint) => ({
      timestamp: dataPoint.timestamp,
      date: dataPoint.date,
      portfolioValue: dataPoint.value,
    }))
    const csv = toCSV(rows, ['timestamp', 'date', 'portfolioValue'])
    const filename = `portfolio_performance_${portfolioId}_${days}d_${new Date().toISOString()}.csv`
    downloadCSV(filename, csv)
  }

  if (!portfolioId || portfolioId === 'demo') {
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

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm animate-pulse motion-safe:animate-pulse" role="status" aria-busy="true">
          <div className="flex items-center justify-between mb-6">
            <div className="w-48 h-6 bg-gray-300 dark:bg-gray-700 rounded" />
            <div className="flex items-center space-x-2">
              <div className="w-32 h-8 bg-gray-300 dark:bg-gray-700 rounded" />
              <div className="w-32 h-8 bg-gray-300 dark:bg-gray-700 rounded" />
            </div>
          </div>
          <div className="h-80 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm animate-pulse motion-safe:animate-pulse">
              <div className="flex items-center justify-between mb-2">
                <div className="w-20 h-3 bg-gray-300 dark:bg-gray-700 rounded" />
                <div className="w-4 h-4 bg-gray-300 dark:bg-gray-700 rounded" />
              </div>
              <div className="w-16 h-6 bg-gray-300 dark:bg-gray-700 rounded mb-2" />
              <div className="w-12 h-3 bg-gray-300 dark:bg-gray-700 rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-center h-64 text-red-500">
          <div className="text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-2" />
            <p role="alert">{performanceChartCopy.loadError}</p>
          </div>
        </div>
      </div>
    )
  }

  const chartData = formatChartData
  const metrics = performanceSummary?.metrics

  const CustomTooltip = ({ active, payload, label }: any) => {
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

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {performanceChartCopy.title}
          </h2>
          <div className="flex items-center gap-2" role="group" aria-label="Time range selector">
            {TIME_RANGES.map((range) => (
              <button
                key={range.value}
                type="button"
                onClick={() => setDays(range.days)}
                aria-pressed={days === range.days}
                aria-label={`Show ${range.label}`}
                className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  days === range.days
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                }`}
              >
                {range.label}
              </button>
            ))}
            <button
              type="button"
              onClick={exportChartDataCSV}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ml-2"
              aria-label="Export chart data as CSV"
            >
              Export
            </button>
          </div>
        </div>

        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
            <div className="text-center">
              <BarChart3 className="w-12 h-12 mx-auto mb-2 text-gray-400 dark:text-gray-500" />
              <p>{performanceChartCopy.emptyTitle}</p>
              <p className="text-sm mt-1">{performanceChartCopy.emptyDetail}</p>
            </div>
          </div>
        ) : (
          <div>
            <div className="h-80" role="img" aria-label={`Portfolio performance chart showing ${chartData.length} data points`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} data-testid="line-chart" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#374151' : '#f0f0f0'} />
                  <XAxis
                    dataKey="date"
                    stroke={isDark ? '#9CA3AF' : '#666'}
                    tick={{ fontSize: 12, fill: isDark ? '#9CA3AF' : '#666' }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    stroke={isDark ? '#9CA3AF' : '#666'}
                    tick={{ fontSize: 12, fill: isDark ? '#9CA3AF' : '#666' }}
                    tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#3B82F6"
                    strokeWidth={3}
                    dot={false}
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
      </div>

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
    </div>
  )
}

export default PerformanceChart
