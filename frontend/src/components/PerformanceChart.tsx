import React, { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { TrendingUp, TrendingDown, BarChart3, AlertCircle } from 'lucide-react'
import { api, ENDPOINTS } from '../config/api'
import { useTheme } from '../context/ThemeContext'

// TanStack Query Hooks
import { usePortfolioAnalytics, usePerformanceSummary } from '../hooks/queries/useAnalyticsQuery'

interface PerformanceChartProps {
    portfolioId: string | null
}

const PerformanceChart: React.FC<PerformanceChartProps> = ({ portfolioId }) => {
    const [days, setDays] = useState(30)
    const { isDark } = useTheme()

    // Query for analytics data
    const { data: analyticsDataResult, isLoading: analyticsLoading, error: analyticsError } = usePortfolioAnalytics(portfolioId, days)

    // Query for performance summary
    const { data: summaryDataResult, isLoading: summaryLoading, error: summaryError } = usePerformanceSummary(portfolioId)

    // Determine finalized data and loading state
    const analyticsData = analyticsDataResult?.data || []
    const performanceSummary = summaryDataResult
    const loading = portfolioId && portfolioId !== 'demo' ? (analyticsLoading || summaryLoading) : false
    const error = analyticsError || summaryError ? 'Failed to load performance data' : null

    const formatChartData = () => {
        return analyticsData.map((snapshot: any) => ({
            date: new Date(snapshot.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            value: Number(snapshot.totalValue.toFixed(2)),
            timestamp: snapshot.timestamp
        }))
    }

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(value)
    }

    const formatPercentage = (value: number) => {
        return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
    }

    if (!portfolioId || portfolioId === 'demo') {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
                <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
                    <div className="text-center">
                        <BarChart3 className="w-12 h-12 mx-auto mb-2 text-gray-400 dark:text-gray-500" />
                        <p>Connect a wallet and create a portfolio to view performance analytics</p>
                    </div>
                </div>
            </div>
        )
    }

    // NEW: Show skeleton loading state for chart
    if (loading) {
        return (
            <div className="space-y-6">
                <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm animate-pulse">
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
                        <div key={i} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm animate-pulse">
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
                        <p>{error}</p>
                    </div>
                </div>
            </div>
        )
    }

    const chartData = formatChartData()
    const metrics = performanceSummary?.metrics

    return (
        <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Portfolio Performance</h2>
                    <div className="flex items-center space-x-2">
                        <select
                            value={days}
                            onChange={(e) => setDays(Number(e.target.value))}
                            className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        >
                            <option value={7}>7 days</option>
                            <option value={30}>30 days</option>
                            <option value={90}>90 days</option>
                        </select>
                    </div>
                </div>

                {chartData.length === 0 ? (
                    <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
                        <div className="text-center">
                            <BarChart3 className="w-12 h-12 mx-auto mb-2 text-gray-400 dark:text-gray-500" />
                            <p>No performance data available yet</p>
                            <p className="text-sm mt-1">Data will appear as your portfolio value changes</p>
                        </div>
                    </div>
                ) : (
                    <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
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
                                    name="Portfolio Value"
                                />
                            </LineChart>
                        </ResponsiveContainer>
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
