import { useState, useEffect } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { Shield, Share2, Clock, User } from 'lucide-react'
import { api, ENDPOINTS } from '../config/api'

interface PublicPortfolioData {
  portfolio: {
    id: string
    allocations: Record<string, number>
    totalValue: number
    threshold: number
    lastRebalance: string
    createdAt: string
  }
  owner: { address: string }
  sharedAt: string
}

interface PublicPortfolioProps {
  hash: string
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899']

function PublicPortfolio({ hash }: PublicPortfolioProps) {
  const [data, setData] = useState<PublicPortfolioData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchSharedPortfolio = async () => {
      try {
        const res = await api.get<PublicPortfolioData>(ENDPOINTS.PORTFOLIO_SHARE_VIEW(hash))
        setData(res)
      } catch (err: any) {
        if (err.status === 410) {
          setError('This share link has been revoked by the owner.')
        } else if (err.status === 404) {
          setError('Share link not found.')
        } else {
          setError(err.message || 'Failed to load portfolio')
        }
      } finally {
        setLoading(false)
      }
    }
    fetchSharedPortfolio()
  }, [hash])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-8">
          <Shield className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            Portfolio Unavailable
          </h1>
          <p className="text-gray-600 dark:text-gray-400">{error}</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  const allocationEntries = Object.entries(data.portfolio.allocations || {})
  const allocationData = allocationEntries.map(([asset, percentage], index) => ({
    name: asset,
    value: percentage,
    color: COLORS[index % COLORS.length],
  }))

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 to-blue-800 px-6 py-4">
            <div className="flex items-center gap-2 mb-1">
              <Share2 className="w-4 h-4 text-blue-200" />
              <span className="text-xs font-medium text-blue-200 uppercase tracking-wider">
                Shared Portfolio
              </span>
            </div>
            <h1 className="text-xl font-bold text-white">Portfolio Snapshot</h1>
          </div>

          <div className="p-6 space-y-6">
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <User className="w-4 h-4" />
              <span>
                Shared by{' '}
                <span className="font-mono font-medium text-gray-900 dark:text-white">
                  {data.owner.address}
                </span>
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                  Total Value
                </div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  ${data.portfolio.totalValue?.toLocaleString() || '0'}
                </div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                  Rebalance Threshold
                </div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {data.portfolio.threshold}%
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <Clock className="w-3 h-3" />
              <span>
                Shared{' '}
                {new Date(data.sharedAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
              {data.portfolio.lastRebalance && data.portfolio.lastRebalance !== 'Never' ? (
                <span>
                  &middot; Last rebalance{' '}
                  {new Date(data.portfolio.lastRebalance).toLocaleDateString()}
                </span>
              ) : null}
            </div>

            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Allocation
              </h2>
              {allocationData.length > 0 ? (
                <div className="flex flex-col sm:flex-row items-center gap-6">
                  <div className="h-48 w-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={allocationData}
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={80}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          {allocationData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex-1 space-y-2 w-full">
                    {allocationData.map((asset) => (
                      <div
                        key={asset.name}
                        className="flex items-center justify-between py-1.5"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: asset.color }}
                          />
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            {asset.name}
                          </span>
                        </div>
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                          {asset.value}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                  No allocation data available.
                </p>
              )}
            </div>

            {data.portfolio.createdAt ? (
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Portfolio created{' '}
                  {new Date(data.portfolio.createdAt).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export default PublicPortfolio
