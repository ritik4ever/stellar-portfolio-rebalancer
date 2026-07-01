import React, { useState } from 'react'
import { Clock, ArrowRight, CheckCircle, AlertTriangle, TrendingUp, TrendingDown, Calendar, Link, Search, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { useRebalanceHistory } from '../hooks/queries/useHistoryQuery'
import { formatShortDate, formatTime, formatNumber } from '../utils/localeFormat'

// Extended interface matching RebalanceHistory but adding txHash for the requirement
interface RebalanceEvent {
    id: string
    timestamp: string
    dateFormatted?: string
    timeFormatted?: string
    trigger: string
    trades: number
    gasUsed: string
    status: 'completed' | 'failed' | 'pending'
    portfolioId: string
    txHash?: string // New field for timeline
    eventSource?: 'offchain' | 'simulated' | 'onchain'
    onChainConfirmed?: boolean
    isSimulated?: boolean
    details?: {
        fromAsset?: string
        toAsset?: string
        amount?: number
        reason?: string
        volatilityDetected?: boolean
        riskLevel?: 'low' | 'medium' | 'high'
        priceDirection?: 'up' | 'down'
        performanceImpact?: 'positive' | 'negative' | 'neutral'
        executionTime?: number
        chain?: string
        gasFeeXlm?: number
        gasFeeUsd?: number
        gasPerTradeXlm?: number
        gasWarning?: boolean
        gasBreakdown?: Array<{ tradeId: string, fromAsset?: string, toAsset?: string, feeXlm: number }>
    }
}

interface RebalanceTimelineProps {
    portfolioId?: string
}

const RebalanceTimeline: React.FC<RebalanceTimelineProps> = ({ portfolioId }) => {
    // We use a large limit to render up to 100 entries without lag as per AC
    const limit = 100
    const [triggerFilter, setTriggerFilter] = useState('')
    const [dateRangeFilter, setDateRangeFilter] = useState('')
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

    const { data, isLoading, error } = useRebalanceHistory(portfolioId, 1, limit, '', '', triggerFilter, dateRangeFilter)

    const toggleRow = (id: string) => {
        setExpandedRows(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    // Mock demo data matching RebalanceHistory.tsx if demo/null
    const getDemoHistory = (): RebalanceEvent[] => {
        const now = new Date()
        return [
            {
                id: '1',
                timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
                trigger: 'Threshold exceeded (8.2%)',
                trades: 3,
                gasUsed: '0.0234 XLM',
                status: 'completed',
                portfolioId: portfolioId || 'demo',
                txHash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                details: {
                    gasFeeXlm: 0.0234,
                    amount: 1200,
                    gasBreakdown: [
                        { tradeId: 'trade-1', fromAsset: 'XLM', toAsset: 'ETH', feeXlm: 0.0078 },
                        { tradeId: 'trade-2', fromAsset: 'USDC', toAsset: 'XLM', feeXlm: 0.0078 },
                        { tradeId: 'trade-3', fromAsset: 'BTC', toAsset: 'USDC', feeXlm: 0.0078 }
                    ]
                }
            },
            {
                id: '2',
                timestamp: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
                trigger: 'Scheduled rebalance',
                trades: 2,
                gasUsed: '0.0156 XLM',
                status: 'completed',
                portfolioId: portfolioId || 'demo',
                txHash: '0987654321fedcba0987654321fedcba0987654321fedcba0987654321fedcba',
                details: {
                    gasFeeXlm: 0.0156,
                    amount: 800,
                    gasBreakdown: [
                        { tradeId: 'trade-1', fromAsset: 'XLM', toAsset: 'USDC', feeXlm: 0.0078 },
                        { tradeId: 'trade-2', fromAsset: 'ETH', toAsset: 'XLM', feeXlm: 0.0078 }
                    ]
                }
            }
        ]
    }

    let history: RebalanceEvent[] = data?.history || (portfolioId === 'demo' || !portfolioId ? getDemoHistory() : [])
    if (triggerFilter) history = history.filter(e => e.trigger.toLowerCase().includes(triggerFilter.toLowerCase()))
    if (dateRangeFilter) history = history.filter(e => e.timestamp.startsWith(dateRangeFilter))

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'completed': return <CheckCircle className="w-5 h-5 text-green-600" />
            case 'failed': return <AlertTriangle className="w-5 h-5 text-red-600" />
            case 'pending': return <Clock className="w-5 h-5 text-yellow-600" />
            default: return <CheckCircle className="w-5 h-5 text-gray-400" />
        }
    }

    const getStatusBgColor = (status: string) => {
        switch (status) {
            case 'completed': return 'bg-green-100'
            case 'failed': return 'bg-red-100'
            case 'pending': return 'bg-yellow-100'
            default: return 'bg-gray-100'
        }
    }

    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
            <header className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 dark:border-gray-700 pb-4">
                <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">Rebalance Timeline</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">View history of portfolio rebalances</p>
                </div>
                <div className="flex items-center gap-3">
                    <select 
                        className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                        value={triggerFilter}
                        onChange={(e) => setTriggerFilter(e.target.value)}
                    >
                        <option value="">All Triggers</option>
                        <option value="Threshold">Threshold</option>
                        <option value="Scheduled">Scheduled</option>
                        <option value="Manual">Manual</option>
                    </select>
                    <input 
                        type="date"
                        className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                        value={dateRangeFilter}
                        onChange={(e) => setDateRangeFilter(e.target.value)}
                    />
                </div>
            </header>

            {isLoading && !data ? (
                <div className="animate-pulse space-y-8">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="flex gap-4">
                            <div className="w-12 flex flex-col items-center">
                                <div className="w-4 h-4 rounded-full bg-gray-200 dark:bg-gray-700"></div>
                                <div className="flex-1 w-0.5 bg-gray-200 dark:bg-gray-700 my-2 min-h-[40px]"></div>
                            </div>
                            <div className="flex-1 h-20 bg-gray-100 dark:bg-gray-700 rounded-lg"></div>
                        </div>
                    ))}
                </div>
            ) : error ? (
                <div className="text-red-500 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-center">
                    Failed to load timeline.
                </div>
            ) : history.length === 0 ? (
                <div className="text-center text-gray-500 dark:text-gray-400 py-10">
                    No rebalance history found.
                </div>
            ) : (
                <div className="relative">
                    {/* Vertical timeline line */}
                    <div className="absolute left-6 top-2 bottom-2 w-0.5 bg-gray-200 dark:bg-gray-700 hidden sm:block"></div>
                    
                    <div className="space-y-6">
                        {history.map((event, index) => {
                            const isExpanded = expandedRows.has(event.id)
                            
                            return (
                                <div key={event.id} className="relative flex flex-col sm:flex-row gap-4 sm:gap-6">
                                    {/* Timeline Marker & Timestamp */}
                                    <div className="sm:w-32 flex flex-row sm:flex-col items-center sm:items-end gap-2 sm:gap-1 pt-3 sm:pt-4 z-10 relative bg-white dark:bg-gray-800">
                                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                                            {formatShortDate(event.timestamp)}
                                        </div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400">
                                            {formatTime(event.timestamp)}
                                        </div>
                                        <div className="absolute left-[-1.125rem] sm:left-auto sm:right-[-1.5rem] top-4 w-4 h-4 rounded-full bg-blue-500 border-4 border-white dark:border-gray-800 shadow hidden sm:block"></div>
                                    </div>

                                    {/* Timeline Card */}
                                    <div className="flex-1 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden hover:shadow-md transition-shadow">
                                        <div 
                                            className="p-4 sm:p-5 cursor-pointer flex items-start sm:items-center justify-between gap-4"
                                            onClick={() => toggleRow(event.id)}
                                        >
                                            <div className="flex items-center gap-4 flex-1">
                                                <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${getStatusBgColor(event.status)}`}>
                                                    {getStatusIcon(event.status)}
                                                </div>
                                                <div>
                                                    <h3 className="font-semibold text-gray-900 dark:text-white">{event.trigger}</h3>
                                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-gray-600 dark:text-gray-400">
                                                        <span className="flex items-center gap-1 font-medium bg-gray-200 dark:bg-gray-700 px-2 py-0.5 rounded text-xs">
                                                            {event.trades} Trade{event.trades !== 1 ? 's' : ''}
                                                        </span>
                                                        <span>Fee: {event.gasUsed}</span>
                                                        {event.details?.amount && (
                                                            <span>Vol: ${formatNumber(event.details.amount)}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex-shrink-0 text-gray-400">
                                                {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                                            </div>
                                        </div>

                                        {/* Expanded Details */}
                                        {isExpanded && (
                                            <div className="bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-700 p-4 sm:p-5">
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                                    <div>
                                                        <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Trade Legs</h4>
                                                        {event.details?.gasBreakdown && event.details.gasBreakdown.length > 0 ? (
                                                            <div className="space-y-2">
                                                                {event.details.gasBreakdown.map(leg => (
                                                                    <div key={leg.tradeId} className="flex items-center justify-between text-sm bg-gray-50 dark:bg-gray-800 px-3 py-2 rounded-lg border border-gray-100 dark:border-gray-700">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="font-medium text-gray-900 dark:text-white">{leg.fromAsset || '???'}</span>
                                                                            <ArrowRight className="w-3 h-3 text-gray-400" />
                                                                            <span className="font-medium text-gray-900 dark:text-white">{leg.toAsset || '???'}</span>
                                                                        </div>
                                                                        <span className="text-gray-500 dark:text-gray-400">{leg.feeXlm.toFixed(4)} XLM fee</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <div className="text-sm text-gray-500 italic">No breakdown available</div>
                                                        )}
                                                    </div>
                                                    
                                                    <div className="space-y-4">
                                                        <div>
                                                            <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">Network Transaction</h4>
                                                            {event.txHash ? (
                                                                <a 
                                                                    href={`https://stellar.expert/explorer/public/tx/${event.txHash}`} 
                                                                    target="_blank" 
                                                                    rel="noopener noreferrer"
                                                                    className="inline-flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                                                                >
                                                                    <ExternalLink className="w-4 h-4" />
                                                                    View on Stellar Explorer
                                                                </a>
                                                            ) : (
                                                                <span className="text-sm text-gray-500 italic">No transaction hash available</span>
                                                            )}
                                                        </div>
                                                        
                                                        {event.details?.reason && (
                                                            <div>
                                                                <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-1">Reason</h4>
                                                                <p className="text-sm text-gray-600 dark:text-gray-400">{event.details.reason}</p>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}

export default RebalanceTimeline
