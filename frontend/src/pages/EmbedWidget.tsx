import { useState, useEffect } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { api, ENDPOINTS } from '../config/api'
import { appCopy } from '../content/uiCopy'

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

interface EmbedWidgetProps {
  id: string
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899']

function EmbedWidget({ id }: EmbedWidgetProps) {
  const [data, setData] = useState<PublicPortfolioData | null>(null)
  const [performancePercent, setPerformancePercent] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchSharedPortfolio = async () => {
      try {
        const res = await api.get<PublicPortfolioData>(ENDPOINTS.PORTFOLIO_SHARE_VIEW(id))
        setData(res)
        
        // Attempt to fetch performance, ignore if it fails (not public or error)
        try {
          const perfRes = await api.get<any>(ENDPOINTS.PORTFOLIO_PERFORMANCE_SUMMARY(res.portfolio.id))
          if (perfRes?.totalReturnPercent !== undefined) {
            setPerformancePercent(perfRes.totalReturnPercent)
          }
        } catch (e) {
          // Silent fail for performance summary on embed
        }
      } catch (err: any) {
        if (err.status === 410) {
          setError('Share link revoked.')
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
  }, [id])

  if (loading) {
    return (
      <div className="h-screen w-full bg-white dark:bg-slate-950 flex items-center justify-center m-0 p-0 overflow-hidden">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="h-screen w-full bg-white dark:bg-slate-950 flex items-center justify-center p-4 text-center m-0 overflow-hidden">
        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">{error || 'Portfolio Unavailable'}</p>
      </div>
    )
  }

  const allocationEntries = Object.entries(data.portfolio.allocations || {})
  const topAssets = allocationEntries
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)

  const allocationData = allocationEntries.map(([asset, percentage], index) => ({
    name: asset,
    value: percentage,
    color: COLORS[index % COLORS.length],
  }))

  const lastRebalanceDate = data.portfolio.lastRebalance && data.portfolio.lastRebalance !== 'Never'
    ? new Date(data.portfolio.lastRebalance).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Never'

  return (
    <div className="h-screen w-full bg-white dark:bg-slate-950 overflow-hidden flex flex-col font-sans text-slate-900 dark:text-slate-50 m-0 p-0">
      <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50 shrink-0">
        <div>
          <div className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider mb-1">
            Portfolio Value
          </div>
          <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            ${data.portfolio.totalValue?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider mb-1">
            Performance
          </div>
          <div className={`text-sm sm:text-base font-bold ${
            performancePercent === null ? 'text-slate-400' :
            performancePercent >= 0 ? 'text-emerald-500' : 'text-red-500'
          }`}>
            {performancePercent === null 
              ? 'N/A' 
              : `${performancePercent > 0 ? '+' : ''}${performancePercent.toFixed(2)}%`}
          </div>
        </div>
      </div>
      
      <div className="flex-1 flex flex-row items-center justify-center p-2 sm:p-4 gap-4 sm:gap-8 overflow-hidden min-h-0">
        <div className="w-24 h-24 sm:w-36 sm:h-36 shrink-0 relative">
           <ResponsiveContainer width="100%" height="100%">
             <PieChart>
               <Pie
                 data={allocationData}
                 cx="50%"
                 cy="50%"
                 innerRadius={30}
                 outerRadius={45}
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
        
        <div className="flex-1 min-w-0 max-w-[160px] sm:max-w-[200px]">
          <h3 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800 pb-1">
            Top Assets
          </h3>
          <div className="space-y-1.5 sm:space-y-2">
            {topAssets.map(([asset, value], idx) => (
              <div key={asset} className="flex justify-between items-center text-xs sm:text-sm">
                <div className="flex items-center gap-1.5 sm:gap-2 truncate">
                  <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                  <span className="font-semibold text-slate-700 dark:text-slate-300 truncate">{asset}</span>
                </div>
                <span className="text-slate-500 dark:text-slate-400 font-medium ml-2">{value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="px-3 sm:px-4 py-2 sm:py-3 bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800 text-[10px] sm:text-xs flex justify-between items-center shrink-0">
        <span className="text-slate-500 dark:text-slate-400 font-medium">Rebalanced: {lastRebalanceDate}</span>
        <a 
          href={`/public/${id}`} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 font-semibold transition-colors"
        >
          View &rarr;
        </a>
      </div>
    </div>
  )
}

export default EmbedWidget
