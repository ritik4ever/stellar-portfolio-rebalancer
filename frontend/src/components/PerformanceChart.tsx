
import { useTheme } from '../context/ThemeContext'
import { usePortfolioAnalytics, usePerformanceSummary } from '../hooks/queries/useAnalyticsQuery'
import { useRebalanceHistory } from '../hooks/queries/useHistoryQuery'
import { performanceChartCopy, DEFAULT_LOCALE } from '../content/uiCopy'
import { formatUsdCompact, formatPercent } from '../utils/localeFormat'

// Export utilities
import { downloadCSV, toCSV } from '../utils/export'

interface PerformanceChartProps {
    portfolioId: string | null
}

const PerformanceChart: React.FC<PerformanceChartProps> = ({ portfolioId }) => {
    const [days, setDays] = useState(30)
    const [compareMode, setCompareMode] = useState(false)
    const { isDark } = useTheme()

    const requestedDays = compareMode ? days * 2 : days

    // Query for analytics data
    const { data: analyticsDataResult, isLoading: analyticsLoading, error: analyticsError } = usePortfolioAnalytics(portfolioId, requestedDays)

    // Query for performance summary
    const { data: summaryDataResult, isLoading: summaryLoading, error: summaryError } = usePerformanceSummary(portfolioId)

    // Query for rebalance history events used for chart markers
    const { data: historyResult, isLoading: historyLoading, error: historyError } = useRebalanceHistory(portfolioId, 1, 50)

    // Determine finalized data and loading state
    const analyticsData = analyticsDataResult?.data || []
    const performanceSummary = summaryDataResult
    const loading = portfolioId && portfolioId !== 'demo' ? (analyticsLoading || summaryLoading || historyLoading) : false
    const error = analyticsError || summaryError || historyError ? 'Failed to load performance data' : null

    const formatChartData = useMemo(() => {
        return analyticsData.map((snapshot: any) => {
            const value = typeof snapshot.totalValue === 'number' ? snapshot.totalValue : Number(snapshot.totalValue || 0)
            const date = new Date(snapshot.timestamp)
            return {
                date: Number.isFinite(date.getTime())
                    ? date.toLocaleDateString(DEFAULT_LOCALE, { month: 'short', day: 'numeric' })
                    : 'Unknown',
                value: Number.isFinite(value) ? Number(value.toFixed(2)) : 0,
                timestamp: snapshot.timestamp,
            }
        })
    }, [analyticsData])

    const formatCurrency = (value: number) => formatUsdCompact(value)
    const formatPercentage = (value: number) => formatPercent(value)

    // Export chart data as CSV
    const exportChartDataCSV = () => {
        const chartData = formatChartData()
        const rows = chartData.map((dataPoint) => ({
            timestamp: dataPoint.timestamp,
            date: dataPoint.date,
            portfolioValue: dataPoint.value
        }))

        const csv = toCSV(rows, ['timestamp', 'date', 'portfolioValue'])
        const filename = `portfolio_performance_${portfolioId}_${days}days_${new Date().toISOString()}.csv`
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

    // NEW: Show skeleton loading state for chart
    if (loading) {
        return (
            <div className="space-y-6">
                <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm animate-pulse motion-safe:animate-pulse" role="status" aria-busy="true">
                    <div className="flex items-center justify-between mb-6">
                        <div className="w-48 h-6 bg-gray-300 dark:bg-gray-700 rounded" />
                        <div className="w-32 h-8 bg-gray-300 dark:bg-gray-700 rounded" />
                    </div>
                    {/* Skeleton chart area */}
                    <div className="h-80 bg-gray-200 dark:bg-gray-700 rounded" />
                </div>

                {/* Skeleton metrics grid */}
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
    const currentPeriodData = compareMode ? chartData.slice(-days) : chartData
    const previousPeriodData = compareMode && chartData.length > days ? chartData.slice(0, chartData.length - days) : []
    const compareUnavailable = compareMode && previousPeriodData.length < days

    return (
        <section className="space-y-6" aria-labelledby="performance-chart-heading">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">

                        <select
                            value={days}
                            onChange={(e) => setDays(Number(e.target.value))}
                            className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        >
                            <option value={7}>{performanceChartCopy.days7}</option>
                            <option value={30}>{performanceChartCopy.days30}</option>
                            <option value={90}>{performanceChartCopy.days90}</option>
                        </select>
                        <button
                            type="button"
                            onClick={() => setCompareMode((current) => !current)}
                            className={`px-3 py-1 text-sm rounded-lg border ${compareMode ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600'} hover:shadow-sm transition-colors`}
                        >
                            {compareMode ? performanceChartCopy.compareEnabled : performanceChartCopy.compareDisabled}
                        </button>
                    </div>
                </div>

                {currentPeriodData.length === 0 ? (
                    <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
                        <div className="text-center">
                            <BarChart3 className="w-12 h-12 mx-auto mb-2 text-gray-400 dark:text-gray-500" />
                            <p>{performanceChartCopy.emptyTitle}</p>
                            <p className="text-sm mt-1">{performanceChartCopy.emptyDetail}</p>
                        </div>
                    </div>
                ) : (
                    <div>
                        <div className="h-80">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={currentPeriodData} data-testid="line-chart" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
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
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: isDark ? '#1F2937' : '#fff',
                                            border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                                            borderRadius: '8px',
                                            padding: '8px 12px',
                                            color: isDark ? '#F9FAFB' : '#111827'
                                        }}
                                        formatter={(value: number) => formatCurrency(value)}
                                        labelFormatter={(label) => `Date: ${label}`}
                                    />
                                    <Legend />
                                    <Line
                                        type="monotone"
                                        dataKey="value"
                                        stroke="#3B82F6"
                                        strokeWidth={3}
                                        dot={false}
                                        name="Current period"
                                    />
                                    {previousPeriodData.length > 0 && (
                                        <Line
                                            type="monotone"
                                            dataKey="value"
                                            data={previousPeriodData}
                                            stroke="#A855F7"
                                            strokeWidth={2}
                                            dot={false}
                                            strokeDasharray="5 5"
                                            name="Prior period"
                                        />
                                    )}
                                    {(historyResult?.history ?? []).map((event: any) => {
                                        const eventTimestamp = new Date(event.timestamp).getTime()
                                        const bestMatch = currentPeriodData
                                            .concat(previousPeriodData)
                                            .reduce((best: any | null, item: any) => {
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
                        {compareUnavailable && (
                            <div className="mt-4 text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                                {performanceChartCopy.compareUnavailable}
                            </div>
                        )}
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
        </section>
    )
}

export default PerformanceChart
