import { useState, useEffect, useMemo } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { api, ENDPOINTS } from '../config/api'
import { appCopy } from '../content/uiCopy'

type WidgetSize = 'small' | 'medium' | 'large'
type WidgetTheme = 'light' | 'dark'

const VALID_SIZES: WidgetSize[] = ['small', 'medium', 'large']
const VALID_THEMES: WidgetTheme[] = ['light', 'dark']

const SIZE_CLASSES: Record<WidgetSize, { container: string; value: string; asset: string; label: string; footer: string }> = {
  small: {
    container: 'text-xs',
    value: 'text-lg sm:text-xl',
    asset: 'text-[10px] sm:text-xs',
    label: 'text-[9px] sm:text-[10px]',
    footer: 'text-[9px] sm:text-[10px]',
  },
  medium: {
    container: 'text-sm',
    value: 'text-xl sm:text-2xl',
    asset: 'text-xs sm:text-sm',
    label: 'text-[10px] sm:text-xs',
    footer: 'text-[10px] sm:text-xs',
  },
  large: {
    container: 'text-base',
    value: 'text-2xl sm:text-3xl',
    asset: 'text-sm sm:text-base',
    label: 'text-xs sm:text-sm',
    footer: 'text-xs sm:text-sm',
  },
}

export function parseWidgetParams(search?: string): { size: WidgetSize; theme: WidgetTheme } {
  const params = new URLSearchParams(search ?? window.location.search)
  const rawSize = params.get('size')?.toLowerCase()
  const rawTheme = params.get('theme')?.toLowerCase()
  const size = VALID_SIZES.includes(rawSize as WidgetSize) ? (rawSize as WidgetSize) : 'medium'
  const theme = VALID_THEMES.includes(rawTheme as WidgetTheme) ? (rawTheme as WidgetTheme) : 'light'
  return { size, theme }
}

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
  const { size, theme } = useMemo(() => parseWidgetParams(), [])
  const s = SIZE_CLASSES[size]
  const isDark = theme === 'dark'

  useEffect(() => {
    const fetchSharedPortfolio = async () => {
      try {
        const res = await api.get<PublicPortfolioData>(ENDPOINTS.PORTFOLIO_SHARE_VIEW(id))
        setData(res)
        
       
        try {
          const perfRes = await api.get<any>(ENDPOINTS.PORTFOLIO_PERFORMANCE_SUMMARY(res.portfolio.id))
          if (perfRes?.totalReturnPercent !== undefined) {
            setPerformancePercent(perfRes.totalReturnPercent)
          }
        } catch (e) {
          
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
      <div className={`h-screen w-full bg-white dark:bg-slate-950 flex items-center justify-center m-0 p-0 overflow-hidden ${s.container}`}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className={`h-screen w-full bg-white dark:bg-slate-950 flex items-center justify-center p-4 text-center m-0 overflow-hidden ${s.container}`}>
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
    <div className={`h-screen w-full ${isDark ? 'bg-slate-950 text-slate-50' : 'bg-white text-slate-900'} overflow-hidden flex flex-col font-sans m-0 p-0 ${s.container}`}>
      <div className={`p-4 border-b ${isDark ? 'border-slate-800' : 'border-slate-100'} flex justify-between items-center ${isDark ? 'bg-slate-900/50' : 'bg-slate-50/50'} shrink-0`}>
        <div>
          <div className={`${s.label} font-bold uppercase tracking-wider mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Portfolio Value
          </div>
          <div className={`${s.value} font-black tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>
            ${data.portfolio.totalValue?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
          </div>
        </div>
        <div className="text-right">
          <div className={`${s.label} font-bold uppercase tracking-wider mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Performance
          </div>
          <div className={`${s.asset} font-bold ${
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
        <div className={`${size === 'small' ? 'w-16 h-16 sm:w-24 sm:h-24' : size === 'large' ? 'w-32 h-32 sm:w-48 sm:h-48' : 'w-24 h-24 sm:w-36 sm:h-36'} shrink-0 relative`}>
           <ResponsiveContainer width="100%" height="100%">
             <PieChart>
               <Pie
                 data={allocationData}
                 cx="50%"
                 cy="50%"
                 innerRadius={size === 'small' ? 22 : size === 'large' ? 40 : 30}
                 outerRadius={size === 'small' ? 32 : size === 'large' ? 60 : 45}
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
          <h3 className={`${s.label} font-bold ${isDark ? 'text-slate-400' : 'text-slate-500'} mb-2 uppercase tracking-wider ${isDark ? 'border-slate-800' : 'border-slate-100'} border-b pb-1`}>
            Top Assets
          </h3>
          <div className="space-y-1.5 sm:space-y-2">
            {topAssets.map(([asset, value], idx) => (
              <div key={asset} className={`flex justify-between items-center ${s.asset}`}>
                <div className="flex items-center gap-1.5 sm:gap-2 truncate">
                  <div className={`${size === 'small' ? 'w-1 h-1' : 'w-1.5 h-1.5'} sm:w-2 sm:h-2 rounded-full shrink-0`} style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                  <span className={`font-semibold truncate ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{asset}</span>
                </div>
                <span className={`${isDark ? 'text-slate-400' : 'text-slate-500'} font-medium ml-2`}>{value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={`px-3 sm:px-4 py-2 sm:py-3 ${isDark ? 'bg-slate-900/50 border-slate-800' : 'bg-slate-50/50 border-slate-100'} border-t ${s.footer} flex justify-between items-center shrink-0`}>
        <span className={`font-medium ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Rebalanced: {lastRebalanceDate}</span>
        <a 
          href={`/public/${id}`} 
          target="_blank" 
          rel="noopener noreferrer" 
          className={`font-semibold transition-colors ${isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-500 hover:text-blue-600'}`}
        >
          View &rarr;
        </a>
      </div>
    </div>
  )
}

export default EmbedWidget
