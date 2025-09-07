import React, { useState, useEffect } from 'react'
import { Clock, ArrowRight, CheckCircle, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react'
import { API_CONFIG } from '../config/api'

interface RebalanceEvent {
    id: string
    timestamp: string
    trigger: string
    trades: number
    gasUsed: string
    status: 'completed' | 'failed' | 'pending'
    portfolioId: string
    details?: {
        fromAsset?: string
        toAsset?: string
        amount?: number
        reason?: string
        volatilityDetected?: boolean
        riskLevel?: 'low' | 'medium' | 'high'
        priceDirection?: 'up' | 'down' // Add price direction
        performanceImpact?: 'positive' | 'negative' | 'neutral'
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
            let url = `${API_CONFIG.BASE_URL}/api/rebalance/history`
            if (portfolioId) {
                url += `?portfolioId=${portfolioId}`
            }

            const response = await fetch(url)
            if (response.ok) {
                const data = await response.json()
                setHistory(data.history || [])
                setError(null)
            } else {
                // If API fails, show demo data
                setHistory(getDemoHistory())
            }
        } catch (err) {
            console.error('Failed to fetch rebalance history:', err)
            setError('Failed to load rebalance history')
            // Fallback to demo data
            setHistory(getDemoHistory())
        } finally {
            setLoading(false)
        }
    }

    const getDemoHistory = (): RebalanceEvent[] => {
        return [
            {
                id: '1',
                timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
                trigger: 'Threshold exceeded (8.2%)',
                trades: 3,
                gasUsed: '0.0234 XLM',
                status: 'completed',
                portfolioId: portfolioId || 'demo',
                details: {
                    fromAsset: 'XLM',
                    toAsset: 'ETH',
                    amount: 1200,
                    reason: 'XLM allocation exceeded target by 8.2%',
                    riskLevel: 'medium',
                    priceDirection: 'down',
                    performanceImpact: 'negative'
                }
            },
            {
                id: '2',
                timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // 12 hours ago
                trigger: 'Scheduled rebalance',
                trades: 2,
                gasUsed: '0.0156 XLM',
                status: 'completed',
                portfolioId: portfolioId || 'demo',
                details: {
                    reason: 'Daily scheduled rebalance',
                    riskLevel: 'low',
                    priceDirection: 'up',
                    performanceImpact: 'positive'
                }
            },
            {
                id: '3',
                timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
                trigger: 'Volatility circuit breaker',
                trades: 1,
                gasUsed: '0.0089 XLM',
                status: 'completed',
                portfolioId: portfolioId || 'demo',
                details: {
                    reason: 'High volatility detected in ETH, protective rebalance executed',
                    volatilityDetected: true,
                    riskLevel: 'high',
                    priceDirection: 'down',
                    performanceImpact: 'negative'
                }
            },
            {
                id: '4',
                timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 1 week ago
                trigger: 'Manual trigger',
                trades: 4,
                gasUsed: '0.0298 XLM',
                status: 'failed',
                portfolioId: portfolioId || 'demo',
                details: {
                    reason: 'User-initiated rebalance failed due to insufficient liquidity',
                    riskLevel: 'low',
                    priceDirection: 'down',
                    performanceImpact: 'negative'
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
            return `${minutes} minutes ago`
        } else if (diffInHours < 24) {
            const hours = Math.floor(diffInHours)
            return `${hours} hour${hours > 1 ? 's' : ''} ago`
        } else {
            const days = Math.floor(diffInHours / 24)
            return `${days} day${days > 1 ? 's' : ''} ago`
        }
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

    if (loading) {
        return (
            <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="animate-pulse">
                    <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
                    <div className="space-y-3">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-16 bg-gray-100 rounded"></div>
                        ))}
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="bg-white rounded-xl shadow-sm">
            <div className="p-6 border-b border-gray-200">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900">Rebalance History</h2>
                        <p className="text-sm text-gray-500 mt-1">Recent portfolio rebalancing activities with risk management</p>
                    </div>
                    {error && (
                        <div className="text-sm text-red-600 bg-red-50 px-3 py-1 rounded">
                            {error}
                        </div>
                    )}
                </div>
            </div>

            <div className="divide-y divide-gray-100">
                {history.length === 0 ? (
                    <div className="p-6 text-center text-gray-500">
                        <Clock className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                        <p>No rebalancing history yet</p>
                        <p className="text-sm mt-1">Portfolio rebalances will appear here when they occur</p>
                    </div>
                ) : (
                    history.map((event) => (
                        <div key={event.id} className="p-6 hover:bg-gray-50 transition-colors">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-4">
                                    <div className="flex-shrink-0">
                                        <div className={`w-10 h-10 ${getStatusBgColor(event.status)} rounded-full flex items-center justify-center`}>
                                            {getStatusIcon(event.status)}
                                        </div>
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center space-x-2 mb-1">
                                            <span className="font-medium text-gray-900">{event.trigger}</span>
                                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
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
                                            {event.details?.volatilityDetected && (
                                                <span className="text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded flex items-center">
                                                    <TrendingDown className="w-3 h-3 mr-1" />
                                                    Volatility
                                                </span>
                                            )}
                                            {event.details?.performanceImpact && (
                                                <span className={`text-xs px-2 py-1 rounded flex items-center ${event.details.performanceImpact === 'positive'
                                                    ? 'bg-green-100 text-green-800'
                                                    : event.details.performanceImpact === 'negative'
                                                        ? 'bg-red-100 text-red-800'
                                                        : 'bg-gray-100 text-gray-800'
                                                    }`}>
                                                    {event.details.performanceImpact === 'positive' ? (
                                                        <TrendingUp className="w-3 h-3 mr-1" />
                                                    ) : event.details.performanceImpact === 'negative' ? (
                                                        <TrendingDown className="w-3 h-3 mr-1" />
                                                    ) : null}
                                                    {event.details.performanceImpact}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center space-x-4 text-sm text-gray-500">
                                            <div className="flex items-center">
                                                <Clock className="w-4 h-4 mr-1" />
                                                {formatTimestamp(event.timestamp)}
                                            </div>
                                            <span>Gas: {event.gasUsed}</span>
                                            {event.details?.amount && (
                                                <span>Amount: ${event.details.amount.toLocaleString()}</span>
                                            )}
                                        </div>
                                        {event.details?.reason && (
                                            <div className="mt-1 text-sm text-gray-600 italic">
                                                {event.details.reason}
                                            </div>
                                        )}
                                        {event.details?.fromAsset && event.details?.toAsset && (
                                            <div className="mt-1 flex items-center text-sm text-gray-600">
                                                <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs mr-1">
                                                    {event.details.fromAsset}
                                                </span>
                                                <ArrowRight className="w-3 h-3 mx-1" />
                                                <span className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs">
                                                    {event.details.toAsset}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <ArrowRight className="w-4 h-4 text-gray-400" />
                            </div>
                        </div>
                    ))
                )}
            </div>

            {history.length > 0 && (
                <div className="p-4 border-t border-gray-200 bg-gray-50">
                    <div className="flex items-center justify-between text-sm text-gray-600">
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
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default RebalanceHistory