import { useState, useEffect } from 'react'
import { ArrowLeft, BarChart3, Wallet } from 'lucide-react'
import PerformanceChart from '../components/PerformanceChart'
import { useUserPortfolios } from '../hooks/queries/usePortfolioQuery'

interface AnalyticsPageProps {
  onNavigate: (view: string) => void
  publicKey: string | null
}

const AnalyticsPage: React.FC<AnalyticsPageProps> = ({ onNavigate, publicKey }) => {
  const { data: portfolios, isLoading } = useUserPortfolios(publicKey)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (selectedId == null && portfolios && portfolios.length > 0) {
      setSelectedId(portfolios[0].id)
    }
  }, [portfolios, selectedId])

  if (!publicKey) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-6">
        <div className="text-center">
          <Wallet className="w-12 h-12 mx-auto mb-3 text-gray-400 dark:text-gray-500" aria-hidden />
          <p className="text-gray-600 dark:text-gray-400">Connect a wallet to view portfolio analytics</p>
          <button
            type="button"
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
              type="button"
              onClick={() => onNavigate('dashboard')}
              className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
              aria-label="Back to dashboard"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Portfolio Analytics</h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Performance, risk metrics, and benchmark comparison
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Select a portfolio</h2>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" role="status" aria-label="Loading portfolios" />
            </div>
          ) : portfolios && portfolios.length > 0 ? (
            <label className="block">
              <span className="sr-only">Portfolio</span>
              <select
                value={selectedId ?? ''}
                onChange={(e) => setSelectedId(e.target.value)}
                className="w-full max-w-sm px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                {portfolios.map((portfolio) => (
                  <option key={portfolio.id} value={portfolio.id}>
                    {portfolio.name || portfolio.id}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="text-center py-8">
              <BarChart3 className="w-10 h-10 mx-auto mb-2 text-gray-400 dark:text-gray-500" aria-hidden />
              <p className="text-gray-600 dark:text-gray-400">
                No portfolios yet. Create a portfolio to view analytics.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('setup')}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Create Portfolio
              </button>
            </div>
          )}
        </div>

        {selectedId ? (
          <PerformanceChart portfolioId={selectedId} />
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm text-center">
            <p className="text-gray-600 dark:text-gray-400">Select a portfolio to view its performance analytics.</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default AnalyticsPage
