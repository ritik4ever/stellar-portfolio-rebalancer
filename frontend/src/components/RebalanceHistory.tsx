import React, { useState, useEffect } from 'react'
import { Clock, ArrowRight, CheckCircle, AlertTriangle, TrendingUp, TrendingDown, Calendar, Link } from 'lucide-react'
import { api, ENDPOINTS } from '../config/api'

//  NEW: export utils
import { downloadCSV, toCSV } from '../utils/export'

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
        estimatedSlippageBps?: number
        actualSlippageBps?: number
        slippageExceededTolerance?: boolean
        totalSlippageBps?: number
    }
}

interface RebalanceHistoryProps {
    portfolioId?: string
}

const RebalanceHistory: React.FC<RebalanceHistoryProps> = ({ portfolioId }) => {
    const [history, setHistory] = useState<RebalanceEvent[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        fetchRebalanceHistory()

        // Refresh every 30 seconds
        const interval = setInterval(fetchRebalanceHistory, 30000)
        return () => clearInterval(interval)
    }, [portfolioId])

    const fetchRebalanceHistory = async () => {
        try {
            const params = portfolioId ? { portfolioId } : undefined
            const payload = await api.get<{ history: RebalanceEvent[] }>(ENDPOINTS.REBALANCE_HISTORY, params)
            console.log('Rebalance history data:', payload)
            setHistory(payload.history || [])
            setError(null)
        } catch (err) {
            console.error('Failed to fetch rebalance history:', err)
            setError('Failed to load rebalance history')
            // Fallback to demo data
            setHistory(getDemoHistory())

        } finally {
            setLoading(false)
        }
    }

    const formatDateTime = (timestamp: string): { dateFormatted: string, timeFormatted: string } => {
        const date = new Date(timestamp)

        const dateFormatted = date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        })

        const timeFormatted = date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        })

        return { dateFormatted, timeFormatted }
    }

    const getDemoHistory = (): RebalanceEvent[] => {
        const now = new Date()

        return [
            {
                id: '1',
                timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
                ...formatDateTime(new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()),
                trigger: 'Threshold exceeded (8.2%)',
                trades: 3,
                gasUsed: '0.0234 XLM',
                status: 'completed',
                portfolioId: portfolioId || 'demo',
                eventSource: 'simulated',
                onChainConfirmed: false,
                isSimulated: true,
                details: {
                    fromAsset: 'XLM',
                    toAsset: 'ETH',
                    amount: 1200,
                    reason: 'Portfolio allocation drift exceeded rebalancing threshold',
                    riskLevel: 'medium',
                    priceDirection: 'down',
                    performanceImpact: 'neutral',
                    executionTime: 2400,
                    chain: 'Stellar'
                }
            },
            {
                id: '2',
                timestamp: new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(),
                ...formatDateTime(new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString()),
                trigger: 'Scheduled rebalance',
                trades: 2,
                gasUsed: '0.0156 XLM',
                status: 'completed',
                portfolioId: portfolioId || 'demo',
                eventSource: 'simulated',
                onChainConfirmed: false,
                isSimulated: true,
                details: {
                    reason: 'Automated scheduled rebalancing executed',
                    riskLevel: 'low',
                    priceDirection: 'up',
                    performanceImpact: 'positive',
                    executionTime: 1800,
                    chain: 'Stellar'
                }
            },
            {
                id: '3',
                timestamp: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
                ...formatDateTime(new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()),
                trigger: 'Volatility circuit breaker',
                trades: 1,
                gasUsed: '0.0089 XLM',
                status: 'completed',
                portfolioId: portfolioId || 'demo',
                eventSource: 'simulated',
                onChainConfirmed: false,
                isSimulated: true,
                details: {
                    reason: 'High market volatility detected, protective rebalance executed',
                    volatilityDetected: true,
                    riskLevel: 'high',
                    priceDirection: 'down',
                    performanceImpact: 'negative',
                    executionTime: 3200,
                    chain: 'Stellar'
                }
            },
            {
                id: '4',
                timestamp: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
                ...formatDateTime(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()),
                trigger: 'Manual rebalance',
                trades: 4,
                gasUsed: '0.0298 XLM',
                status: 'completed',
                portfolioId: portfolioId || 'demo',
                eventSource: 'simulated',
                onChainConfirmed: false,
                isSimulated: true,
                details: {
                    fromAsset: 'BTC',
                    toAsset: 'USDC',
                    amount: 0.05,
                    reason: 'User-initiated manual rebalancing',
                    riskLevel: 'low',
                    priceDirection: 'up',
                    performanceImpact: 'positive',
                    executionTime: 2100,
                    chain: 'Stellar'
                }
            }
        ]
    }

    const formatTimestamp = (timestamp: string) => {
        const date = new Date(timestamp)
        const now = new Date()
        const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60)

        if (diffInHours < 1) {
            const minutes = Math.floor(diffInHours * 60)
            return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`
        } else if (diffInHours < 24) {
            const hours = Math.floor(diffInHours)
            return `${hours} hour${hours > 1 ? 's' : ''} ago`
        } else {
            const days = Math.floor(diffInHours / 24)
            return `${days} day${days > 1 ? 's' : ''} ago`
        }
    }

    const formatExecutionTime = (ms?: number) => {
        if (!ms) return null
        return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
    }

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'completed':
                return <CheckCircle className="w-5 h-5 text-green-600" />
            case 'failed':
                return <AlertTriangle className="w-5 h-5 text-red-600" />
            case 'pending':
                return <Clock className="w-5 h-5 text-yellow-600 animate-pulse" />
            default:
                return <CheckCircle className="w-5 h-5 text-green-600" />
        }
    }

    const getRiskLevelColor = (level?: string) => {
        switch (level) {
            case 'high':
                return 'bg-red-100 text-red-800'
            case 'medium':
                return 'bg-yellow-100 text-yellow-800'
            case 'low':
                return 'bg-green-100 text-green-800'
            default:
                return 'bg-gray-100 text-gray-800'
        }
    }

    const getStatusBgColor = (status: string) => {
        switch (status) {
            case 'completed':
                return 'bg-green-100'
            case 'failed':
                return 'bg-red-100'
            case 'pending':
                return 'bg-yellow-100'
            default:
                return 'bg-green-100'
        }
    }

    const getSourceBadge = (event: RebalanceEvent) => {
        if (event.onChainConfirmed || event.eventSource === 'onchain') {
            return (
                <span className="text-xs bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 px-2 py-1 rounded flex items-center">
                    <Link className="w-3 h-3 mr-1" />
                    On-chain
                </span>
            )
        }
        if (event.isSimulated || event.eventSource === 'simulated') {
            return (
                <span className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-2 py-1 rounded">
                    Simulated
                </span>
            )
        }
        return (
            <span className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-1 rounded">
                Off-chain
            </span>
        )
    }

    //  NEW: Export History as CSV (timestamps + trades + status)
    const exportHistoryCSV = () => {
        const rows = (history || []).map((event) => ({
            timestamp: event.timestamp,
            status: event.status,
            trigger: event.trigger,
            tradesCount: event.trades,
            gasUsed: event.gasUsed,
            portfolioId: event.portfolioId,
            eventSource: event.eventSource ?? '',
            onChainConfirmed: event.onChainConfirmed ? 'true' : 'false',
            chain: event.details?.chain ?? '',
            riskLevel: event.details?.riskLevel ?? '',
            volatilityDetected: event.details?.volatilityDetected ? 'true' : 'false',
            fromAsset: event.details?.fromAsset ?? '',
            toAsset: event.details?.toAsset ?? '',
            amount: event.details?.amount ?? '',
            performanceImpact: event.details?.performanceImpact ?? '',
            priceDirection: event.details?.priceDirection ?? '',
            executionTimeMs: event.details?.executionTime ?? '',
            reason: event.details?.reason ?? '',
            totalSlippageBps: event.details?.totalSlippageBps ?? '',
            slippagePct: event.details?.totalSlippageBps != null ? (event.details.totalSlippageBps / 100).toFixed(2) + '%' : ''
        }))

        const csv = toCSV(rows, [
            'timestamp',
            'status',
            'trigger',
            'tradesCount',
            'gasUsed',
            'portfolioId',
            'eventSource',
            'onChainConfirmed',
            'chain',
            'riskLevel',
            'volatilityDetected',
            'fromAsset',
            'toAsset',
            'amount',
            'performanceImpact',
            'priceDirection',
            'executionTimeMs',
            'reason'
        ])

        const filename = `rebalance_history_${portfolioId ?? 'all'}_${new Date().toISOString()}.csv`
        downloadCSV(filename, csv)
    }

    if (loading) {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
                <div className="animate-pulse">
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-4"></div>
                    <div className="space-y-3">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-16 bg-gray-100 dark:bg-gray-700 rounded"></div>
                        ))}
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Rebalance History</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Recent portfolio rebalancing activities with risk management</p>
                    </div>

                    {/*  NEW: Export button */}
                    <div className="flex items-center space-x-3">
                        <button
                            onClick={exportHistoryCSV}
                            disabled={history.length === 0}
                            className="border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
                        >
                            Export CSV
                        </button>

                        {error && (
                            <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 px-3 py-1 rounded">
                                {error}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {history.length === 0 ? (
                    <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                        <Clock className="w-12 h-12 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
                        <p>No rebalancing history yet</p>
                        <p className="text-sm mt-1">Portfolio rebalances will appear here when they occur</p>
                    </div>
                ) : (
                    history.map((event) => {
                        const { dateFormatted, timeFormatted } = event.dateFormatted && event.timeFormatted
                            ? { dateFormatted: event.dateFormatted, timeFormatted: event.timeFormatted }
                            : formatDateTime(event.timestamp)

                        return (
                            <div key={event.id} className="p-6 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-start space-x-4">
                                        <div className="flex-shrink-0">
                                            <div className={`w-10 h-10 ${getStatusBgColor(event.status)} rounded-full flex items-center justify-center`}>
                                                {getStatusIcon(event.status)}
                                            </div>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center space-x-2 mb-2">
                                                <span className="font-medium text-gray-900 dark:text-white">{event.trigger}</span>
                                                <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-1 rounded">
                                                    {event.trades} trade{event.trades > 1 ? 's' : ''}
                                                </span>
                                                {event.details?.riskLevel && (
                                                    <span className={`text-xs px-2 py-1 rounded flex items-center ${getRiskLevelColor(event.details.riskLevel)}`}>
                                                        {event.details.riskLevel === 'high' ? (
                                                            <TrendingDown className="w-3 h-3 mr-1" />
                                                        ) : event.details.riskLevel === 'medium' ? (
                                                            <TrendingDown className="w-3 h-3 mr-1" />
                                                        ) : (
                                                            <TrendingUp className="w-3 h-3 mr-1" />
                                                        )}
                                                        {event.details.riskLevel} risk
                                                    </span>
                                                )}
                                                {event.details?.chain && (
                                                    <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 px-2 py-1 rounded flex items-center">
                                                        <Link className="w-3 h-3 mr-1" />
                                                        {event.details.chain}
                                                    </span>
                                                )}
                                                {getSourceBadge(event)}
                                            </div>

                                            {/* Enhanced date and time display */}
                                            <div className="flex items-center space-x-4 text-sm text-gray-500 dark:text-gray-400 mb-2">
                                                <div className="flex items-center">
                                                    <Calendar className="w-4 h-4 mr-1" />
                                                    <span className="font-medium">{dateFormatted}</span>
                                                    <span className="mx-1">at</span>
                                                    <span>{timeFormatted}</span>
                                                </div>
                                                <span className="text-gray-300 dark:text-gray-600">•</span>
                                                <div className="flex items-center">
                                                    <Clock className="w-4 h-4 mr-1" />
                                                    {formatTimestamp(event.timestamp)}
                                                </div>
                                            </div>

                                            <div className="flex items-center space-x-4 text-sm text-gray-500 dark:text-gray-400 mb-2">
                                                <span>Gas: {event.gasUsed}</span>
                                                {event.details?.executionTime && (
                                                    <span>Execution: {formatExecutionTime(event.details.executionTime)}</span>
                                                )}
                                                {event.details?.amount && (
                                                    <span>Amount: ${event.details.amount.toLocaleString()}</span>
                                                )}
                                                {event.details?.totalSlippageBps != null && (
                                                    <span>Slippage: {(event.details.totalSlippageBps / 100).toFixed(2)}%</span>
                                                )}
                                            </div>

                                            {/* Enhanced badges */}
                                            <div className="flex items-center space-x-2 mb-2">
                                                {event.details?.volatilityDetected && (
                                                    <span className="text-xs bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300 px-2 py-1 rounded flex items-center">
                                                        <TrendingDown className="w-3 h-3 mr-1" />
                                                        High Volatility
                                                    </span>
                                                )}
                                                {event.details?.performanceImpact && (
                                                    <span className={`text-xs px-2 py-1 rounded flex items-center ${event.details.performanceImpact === 'positive'
                                                        ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300'
                                                        : event.details.performanceImpact === 'negative'
                                                            ? 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300'
                                                            : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                                                        }`}>
                                                        {event.details.performanceImpact === 'positive' ? (
                                                            <TrendingUp className="w-3 h-3 mr-1" />
                                                        ) : event.details.performanceImpact === 'negative' ? (
                                                            <TrendingDown className="w-3 h-3 mr-1" />
                                                        ) : null}
                                                        {event.details.performanceImpact} impact
                                                    </span>
                                                )}
                                                {event.details?.priceDirection && (
                                                    <span className={`text-xs px-2 py-1 rounded flex items-center ${event.details.priceDirection === 'up'
                                                        ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300'
                                                        : 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300'
                                                        }`}>
                                                        {event.details.priceDirection === 'up' ? (
                                                            <TrendingUp className="w-3 h-3 mr-1" />
                                                        ) : (
                                                            <TrendingDown className="w-3 h-3 mr-1" />
                                                        )}
                                                        Market {event.details.priceDirection}
                                                    </span>
                                                )}
                                            </div>

                                            {(event.details?.actualSlippageBps != null || event.details?.estimatedSlippageBps != null) && (
                                                <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                                                    Slippage: {event.details.actualSlippageBps != null ? `${(event.details.actualSlippageBps / 100).toFixed(2)}%` : '—'} actual
                                                    {event.details.estimatedSlippageBps != null && ` (${(event.details.estimatedSlippageBps / 100).toFixed(2)}% max)`}
                                                    {event.details?.slippageExceededTolerance && (
                                                        <span className="ml-1 text-red-600 dark:text-red-400 font-medium">— exceeded tolerance</span>
                                                    )}
                                                </div>
                                            )}
                                            {event.details?.reason && (
                                                <div className="text-sm text-gray-600 dark:text-gray-400 italic mb-2">
                                                    {event.details.reason}
                                                </div>
                                            )}

                                            {event.details?.fromAsset && event.details?.toAsset && (
                                                <div className="flex items-center text-sm">
                                                    <span className="px-2 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded text-xs mr-2">
                                                        {event.details.fromAsset}
                                                    </span>
                                                    <ArrowRight className="w-3 h-3 text-gray-400 mx-1" />
                                                    <span className="px-2 py-1 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-xs ml-2">
                                                        {event.details.toAsset}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <ArrowRight className="w-4 h-4 text-gray-400 mt-2" />
                                </div>
                            </div>
                        )
                    })
                )}
            </div>

            {history.length > 0 && (
                <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                    <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
                        <span>Showing {history.length} recent rebalance{history.length > 1 ? 's' : ''}</span>
                        <div className="flex items-center space-x-4">
                            <div className="flex items-center">
                                <div className="w-2 h-2 bg-green-500 rounded-full mr-1"></div>
                                <span>Automated</span>
                            </div>
                            <div className="flex items-center">
                                <div className="w-2 h-2 bg-orange-500 rounded-full mr-1"></div>
                                <span>Risk Management</span>
                            </div>
                            <div className="flex items-center">
                                <div className="w-2 h-2 bg-red-500 rounded-full mr-1"></div>
                                <span>Failed/High Risk</span>
                            </div>
                            <div className="flex items-center">
                                <div className="w-2 h-2 bg-blue-500 rounded-full mr-1"></div>
                                <span>Stellar Network</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default RebalanceHistory
