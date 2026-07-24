import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { ArrowLeft, CheckCircle2, XCircle, TrendingUp, TrendingDown, Activity, Gauge, RotateCcw } from 'lucide-react'
import { useUserPortfolios } from '../hooks/queries/usePortfolioQuery'
import { usePortfolioCompare } from '../hooks/queries/useAnalyticsQuery'
import { useTranslation } from 'react-i18next'

interface PortfolioCompareProps {
  onNavigate: (view: string) => void
  publicKey: string | null
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899']

const Compare: React.FC<PortfolioCompareProps> = ({ onNavigate, publicKey }) => {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedPortfolioIds, setSelectedPortfolioIds] = useState<string[]>(() => {
    const params = searchParams.get('portfolios')
    return params ? params.split(',') : []
  })

  const { data: portfolios } = useUserPortfolios(publicKey)
  const { data: compareData, isLoading, error } = usePortfolioCompare(selectedPortfolioIds)

  const selectedPortfolios = portfolios?.filter(p => selectedPortfolioIds.includes(p.id)) || []

  useEffect(() => {
    if (selectedPortfolioIds.length > 0) {
      setSearchParams({ portfolios: selectedPortfolioIds.join(',') })
    } else {
      setSearchParams({})
    }
  }, [selectedPortfolioIds, setSearchParams])

  const togglePortfolio = (portfolioId: string) => {
    if (selectedPortfolioIds.includes(portfolioId)) {
      setSelectedPortfolioIds(prev => prev.filter(id => id !== portfolioId))
    } else if (selectedPortfolioIds.length < 3) {
      setSelectedPortfolioIds(prev => [...prev, portfolioId])
    }
  }

  const getAllocationData = (portfolio: any) => {
    if (!portfolio?.allocations) return []

    const allocations = Array.isArray(portfolio.allocations)
      ? portfolio.allocations
      : Object.entries(portfolio.allocations).map(([asset, percentage]) => ({ asset, percentage }))

    return allocations.map((alloc: any, index: number) => ({
      name: alloc.asset || alloc.name,
      value: alloc.percentage || alloc.target || 0,
      color: COLORS[index % COLORS.length]
    }))
  }

  const formatPct = (value: number | undefined | null, decimals = 2) => {
    if (value == null) return '—'
    const sign = value >= 0 ? '+' : ''
    return `${sign}${value.toFixed(decimals)}%`
  }

  const formatNumber = (value: number | undefined | null, decimals = 2) => {
    if (value == null) return '—'
    return value.toFixed(decimals)
  }

  if (!publicKey) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 dark:text-gray-400">Connect wallet to compare portfolios</p>
          <button
            onClick={() => onNavigate('landing')}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Connect Wallet
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => onNavigate('dashboard')}
              className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('compare.title')}</h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">{t('compare.subtitle')}</p>
            </div>
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {selectedPortfolioIds.length}/3 {t('compare.selectPortfolios')}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{t('compare.selectPortfolios')}</h2>
          {portfolios && portfolios.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {portfolios.map((portfolio) => (
                <motion.div
                  key={portfolio.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => togglePortfolio(portfolio.id)}
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    selectedPortfolioIds.includes(portfolio.id)
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-gray-900 dark:text-white">{portfolio.name || portfolio.id}</span>
                    {selectedPortfolioIds.includes(portfolio.id) && (
                      <CheckCircle2 className="w-5 h-5 text-blue-500" />
                    )}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Value: ${portfolio.totalValue?.toLocaleString() || '0'}
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <p className="text-gray-600 dark:text-gray-400">{t('compare.noPortfolios')}</p>
          )}
        </div>

        {selectedPortfolioIds.length >= 2 && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{t('compare.allocation')}</h2>
              <div className={`grid gap-6 ${selectedPortfolioIds.length === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-3'}`}>
                {selectedPortfolios.map((portfolio, index) => {
                  const allocationData = getAllocationData(portfolio)
                  return (
                    <div key={portfolio.id} className="text-center">
                      <h3 className="font-medium text-gray-900 dark:text-white mb-4">
                        {portfolio.name || portfolio.id}
                      </h3>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={allocationData}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={80}
                              paddingAngle={5}
                              dataKey="value"
                            >
                              {allocationData.map((entry: any, i: number) => (
                                <Cell key={`cell-${i}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mt-4 space-y-2">
                        {allocationData.map((asset: any) => (
                          <div key={asset.name} className="flex items-center justify-center gap-2 text-sm">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: asset.color }} />
                            <span className="text-gray-600 dark:text-gray-400">{asset.name}</span>
                            <span className="font-medium text-gray-900 dark:text-white">{asset.value}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Comparison Table */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{t('compare.metrics')}</h2>

              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
                </div>
              ) : error ? (
                <div className="text-center py-8 text-red-500">
                  Failed to load comparison data. Please try again.
                </div>
              ) : compareData?.portfolios ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        <th className="text-left py-3 px-4 text-gray-600 dark:text-gray-400 font-medium">Metric</th>
                        {compareData.portfolios.map((p: any) => (
                          <th key={p.portfolioId} className="text-center py-3 px-4 text-gray-900 dark:text-white font-medium">
                            {p.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="py-3 px-4 text-gray-600 dark:text-gray-400 flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-green-500" />
                          Total Return
                        </td>
                        {compareData.portfolios.map((p: any) => (
                          <td key={p.portfolioId} className={`text-center py-3 px-4 font-medium ${
                            p.totalReturnPct >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {formatPct(p.totalReturnPct)}
                          </td>
                        ))}
                      </tr>
                      <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="py-3 px-4 text-gray-600 dark:text-gray-400 flex items-center gap-2">
                          <Activity className="w-4 h-4 text-orange-500" />
                          Volatility
                        </td>
                        {compareData.portfolios.map((p: any) => (
                          <td key={p.portfolioId} className="text-center py-3 px-4 font-medium text-gray-900 dark:text-white">
                            {formatNumber(p.volatility)}%
                          </td>
                        ))}
                      </tr>
                      <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="py-3 px-4 text-gray-600 dark:text-gray-400 flex items-center gap-2">
                          <TrendingDown className="w-4 h-4 text-red-500" />
                          Max Drawdown
                        </td>
                        {compareData.portfolios.map((p: any) => (
                          <td key={p.portfolioId} className="text-center py-3 px-4 font-medium text-red-600">
                            {formatPct(p.maxDrawdown)}
                          </td>
                        ))}
                      </tr>
                      <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="py-3 px-4 text-gray-600 dark:text-gray-400 flex items-center gap-2">
                          <Gauge className="w-4 h-4 text-blue-500" />
                          Sharpe Ratio
                        </td>
                        {compareData.portfolios.map((p: any) => (
                          <td key={p.portfolioId} className={`text-center py-3 px-4 font-medium ${
                            p.sharpeRatio >= 1 ? 'text-green-600' : p.sharpeRatio >= 0 ? 'text-yellow-600' : 'text-red-600'
                          }`}>
                            {formatNumber(p.sharpeRatio, 3)}
                          </td>
                        ))}
                      </tr>
                      <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="py-3 px-4 text-gray-600 dark:text-gray-400 flex items-center gap-2">
                          <RotateCcw className="w-4 h-4 text-purple-500" />
                          Rebalance Count
                        </td>
                        {compareData.portfolios.map((p: any) => (
                          <td key={p.portfolioId} className="text-center py-3 px-4 font-medium text-gray-900 dark:text-white">
                            {p.rebalanceCount ?? '—'}
                          </td>
                        ))}
                      </tr>
                      <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="py-3 px-4 text-gray-600 dark:text-gray-400">
                          Portfolio Value
                        </td>
                        {compareData.portfolios.map((p: any) => (
                          <td key={p.portfolioId} className="text-center py-3 px-4 font-medium text-gray-900 dark:text-white">
                            ${(p.totalValue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                  {compareData.timeRange?.from && (
                    <p className="mt-4 text-xs text-gray-400 text-center">
                      Period: {new Date(compareData.timeRange.from).toLocaleDateString()} — {compareData.timeRange.to ? new Date(compareData.timeRange.to).toLocaleDateString() : 'Present'}
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        )}

        {selectedPortfolioIds.length === 1 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm text-center">
            <p className="text-gray-600 dark:text-gray-400">{t('compare.selectAtLeastTwo')}</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default Compare
