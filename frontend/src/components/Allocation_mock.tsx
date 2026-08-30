import React, { useState, useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, ReferenceLine,
} from 'recharts'
import { BarChart3, AlertCircle } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'
import { usePortfolioAnalytics } from '../hooks/queries/useAnalyticsQuery'
import { useRebalanceHistory } from '../hooks/queries/useHistoryQuery'
import { DEFAULT_LOCALE } from '../content/uiCopy'

const ASSET_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#06B6D4', '#F97316', '#84CC16', '#6366F1',
]

interface TimeRangeOption {
  label: string
  days: number
}

const TIME_RANGES: TimeRangeOption[] = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
]

interface AllocationHistoryProps {
  portfolioId: string | null
}

function formatChartDate(timestamp: string): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return 'Unknown'
  return date.toLocaleDateString(DEFAULT_LOCALE, { month: 'short', day: 'numeric' })
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

const AllocationHistory: React.FC<AllocationHistoryProps> = ({ portfolioId }) => {
  const [days, setDays] = useState(30)
  const [hiddenAssets, setHiddenAssets] = useState<Set<string>>(new Set())
  const { isDark } = useTheme()

  const { data: analyticsDataResult, isLoading: analyticsLoading, error: analyticsError } = usePortfolioAnalytics(portfolioId, days)
  const { data: historyResult, isLoading: historyLoading, error: historyError } = useRebalanceHistory(portfolioId as string | undefined, 1, 50)

  const dailyValues = analyticsDataResult?.data || analyticsDataResult?.dailyValues || []
  const loading = portfolioId && portfolioId !== 'demo' ? (analyticsLoading || historyLoading) : false
  const error = analyticsError || historyError ? 'Failed to load allocation data' : null

  const assetNames = useMemo(() => {
    const names = new Set<string>()
    for (const snapshot of dailyValues) {
      if (snapshot.allocations && typeof snapshot.allocations === 'object') {
        for (const key of Object.keys(snapshot.allocations)) {
          names.add(key)
        }
      }
    }
    return Array.from(names).sort()
  }, [dailyValues])

  const chartData = useMemo(() => {
    return dailyValues.map((snapshot: any) => {
      const point: Record<string, any> = {
        timestamp: snapshot.timestamp,
        date: formatChartDate(snapshot.timestamp),
      }
      if (snapshot.allocations && typeof snapshot.allocations === 'object') {
        for (const asset of assetNames) {
          const value = snapshot.allocations[asset]
          point[asset] = typeof value === 'number' ? Number(value.toFixed(1)) : 0
        }
      }
      return point
    })
  }, [dailyValues, assetNames])

  const rebalanceEvents = useMemo(() => {
    const events = historyResult?.history || []
    return events.map((event: any) => ({
      id: event.id,
      timestamp: new Date(event.timestamp).getTime(),
      status: event.status as string,
    })).filter((e: any) => Number.isFinite(e.timestamp))
  }, [historyResult])

  const toggleAsset = (asset: string) => {
    setHiddenAssets((prev) => {
      const next = new Set(prev)
      if (next.has(asset)) {
        next.delete(asset)
      } else {
        next.add(asset)
      }
      return next
    })
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const data = payload[0].payload
    const visiblePayload = payload.filter((p: any) => !hiddenAssets.has(p.dataKey))
    return (
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 shadow-lg">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
          {formatTooltipDate(data.timestamp)}
        </p>
        {visiblePayload.map((entry: any) => (
          <div key={entry.dataKey} className="flex items-center gap-2 text-sm">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-gray-700 dark:text-gray-300">{entry.dataKey}:</span>
            <span className="font-semibold text-gray-900 dark:text-white">{entry.value}%</span>
          </div>
        ))}
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 font-medium">
          Total: {visiblePayload.reduce((sum: number, p: any) => sum + (typeof p.value === 'number' ? p.value : 0), 0).toFixed(1)}%
        </p>
      </div>
    )
  }

  const renderCustomLegend = () => {
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-2" role="group" aria-label="Asset toggle legend">
        {assetNames.map((asset, index) => {
          const isHidden = hiddenAssets.has(asset)
          return (
            <button
              key={asset}
              type="button"
              onClick={() => toggleAsset(asset)}
              className={`flex items-center gap-1.5 text-sm transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded px-1.5 py-0.5 ${
                isHidden ? 'opacity-40' : 'opacity-100'
              }`}
              aria-pressed={!isHidden}
              aria-label={`Toggle ${asset} visibility`}
            >
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: ASSET_COLORS[index % ASSET_COLORS.length] }}
              />
              <span className="text-gray-700 dark:text-gray-300">{asset}</span>
            </button>
          )
        })}
      </div>
    )
  }

  if (!portfolioId || portfolioId === 'demo') {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
          <div className="text-center">
            <BarChart3 className="w-12 h-12 mx-auto mb-2 text-gray-400 dark:text-gray-500" />
            <p>Connect a wallet and create a portfolio to view allocation history</p>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm animate-pulse" role="status" aria-busy="true">
        <div className="flex items-center justify-between mb-6">
          <div className="w-48 h-6 bg-gray-300 dark:bg-gray-700 rounded" />
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="w-12 h-8 bg-gray-300 dark:bg-gray-700 rounded" />
            ))}
          </div>
        </div>
        <div className="h-80 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-center h-64 text-red-500">
          <div className="text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-2" />
            <p role="alert">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  const getEventLabel = (status: string) => status === 'failed' ? '⚠' : '●'

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Allocation History
        </h2>
        <div className="flex items-center gap-2" role="group" aria-label="Time range selector">
          {TIME_RANGES.map((range) => (
            <button
              key={range.days}
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
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
          <div className="text-center">
            <BarChart3 className="w-12 h-12 mx-auto mb-2 text-gray-400 dark:text-gray-500" />
            <p>No allocation data available yet</p>
            <p className="text-sm mt-1">Data will appear as your portfolio tracks allocation changes</p>
          </div>
        </div>
      ) : (
        <div>
          <div className="h-80" role="img" aria-label={`Allocation history chart showing ${assetNames.length} assets over ${days} days`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
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
                  tickFormatter={(value) => `${value}%`}
                  domain={[0, 100]}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend content={renderCustomLegend} />
                {assetNames.map((asset, index) => (
                  <Area
                    key={asset}
                    type="monotone"
                    dataKey={asset}
                    stackId="1"
                    stroke={ASSET_COLORS[index % ASSET_COLORS.length]}
                    fill={ASSET_COLORS[index % ASSET_COLORS.length]}
                    fillOpacity={hiddenAssets.has(asset) ? 0.05 : 0.6}
                    strokeOpacity={hiddenAssets.has(asset) ? 0.2 : 1}
                    hide={hiddenAssets.has(asset)}
                    isAnimationActive={false}
                  />
                ))}
                {rebalanceEvents.map((event: any) => {
                  const eventDate = new Date(event.timestamp)
                  const dateStr = formatChartDate(eventDate.toISOString())
                  const match = chartData.find((d: any) => d.date === dateStr)
                  if (!match) return null
                  return (
                    <ReferenceLine
                      key={event.id}
                      x={match.date}
                      stroke={event.status === 'failed' ? '#ef4444' : '#f59e0b'}
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      label={{
                        position: 'top',
                        value: getEventLabel(event.status),
                        fill: isDark ? '#F9FAFB' : '#111827',
                        fontSize: 10,
                      }}
                    />
                  )
                })}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

export default AllocationHistory
