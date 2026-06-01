import React, { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, AlertCircle, RefreshCw, ArrowLeft, ExternalLink, Trash2, Plus, CheckCircle, Zap, Copy } from 'lucide-react'
import ThemeToggle from './ThemeToggle'
import { useTheme } from '../context/ThemeContext'
import AssetCard from './AssetCard'
import RebalanceHistory from './RebalanceHistory'
import PerformanceChart from './PerformanceChart'
import NotificationPreferences from './NotificationPreferences'
import { StellarWallet } from '../utils/stellar'
import PriceTracker from './PriceTracker'
import { API_CONFIG } from '../config/api'

// TanStack Query Hooks
import {
    useUserPortfolios,
    usePortfolioDetails,
    useRebalanceEstimate,
    buildRebalanceConfirmationSummary,
    portfolioKeys,
} from '../hooks/queries/usePortfolioQuery'
import { usePrices, formatPriceFeedSummary, priceKeys } from '../hooks/queries/usePricesQuery'
import { useExecuteRebalanceMutation } from '../hooks/mutations/usePortfolioMutations'
import { useQueryClient } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../config/api'
import { logout as authLogout } from '../services/authService'
import RouteErrorState from './RouteErrorState'


interface DashboardProps {
    onNavigate: (view: string) => void
    publicKey: string | null
}

type DashboardPriceRow = { price?: number; change?: number; [key: string]: unknown }

const Dashboard: React.FC<DashboardProps> = ({ onNavigate, publicKey }) => {
    const [activeTab, setActiveTab] = useState<'overview' | 'analytics' | 'notifications'>('overview')
    const { isDark } = useTheme()

    // Query for user portfolios
    const {
        data: portfolios,
        isLoading: portfoliosLoading,
        isError: portfoliosLoadError,
        error: portfoliosError,
        refetch: refetchPortfolios,
    } = useUserPortfolios(publicKey)

    // Determine the latest portfolio
    const latestPortfolioId = portfolios && portfolios.length > 0
        ? portfolios[portfolios.length - 1].id
        : null

    // Query for portfolio details
    const {
        data: portfolioDetails,
        isLoading: detailsLoading,
        isError: detailsLoadError,
        error: detailsError,
        refetch: refetchPortfolioDetails,
    } = usePortfolioDetails(latestPortfolioId)

    const {
        data: priceBundle,
        isLoading: pricesLoading,
        isError: pricesLoadError,
        refetch: refetchPrices,
    } = usePrices()
    const { data: rebalanceEstimate } = useRebalanceEstimate(latestPortfolioId)

    // Mutation for rebalancing
    const executeRebalanceMutation = useExecuteRebalanceMutation(latestPortfolioId)

    // Demo data fallback
    const demoData = {
        id: 'demo',
        totalValue: 10000,
        dayChange: 0.85,
        needsRebalance: false,
        lastRebalance: '2 hours ago',
        allocations: [
            { asset: 'XLM', target: 40, current: 40.2, amount: 4020 },
            { asset: 'USDC', target: 60, current: 59.8, amount: 5980 }
        ]
    }

    const demoPrices = {
        XLM: { price: 0.354, change: -1.86 },
        USDC: { price: 1.0, change: -0.01 },
        BTC: { price: 110000, change: -1.19 },
        ETH: { price: 4200, change: -1.50 }
    }

    // Determine finalized data and loading state
    const portfolioData = publicKey ? (portfolioDetails || (portfolios && portfolios.length > 0 ? portfolios[portfolios.length - 1] : null)) : demoData
    const priceRows = priceBundle?.prices ?? {}
    const hasLivePriceRows = typeof priceRows === 'object' && Object.keys(priceRows).length > 0
    const prices: Record<string, DashboardPriceRow> = hasLivePriceRows
        ? (priceRows as Record<string, DashboardPriceRow>)
        : demoPrices
    const loading = publicKey ? (portfoliosLoading || (latestPortfolioId ? detailsLoading : false) || (API_CONFIG.USE_BROWSER_PRICES ? false : pricesLoading)) : false
    const routeDataUnavailable = Boolean(
        publicKey &&
        portfoliosLoadError &&
        !portfoliosLoading &&
        (!portfolios || portfolios.length === 0),
    )
    const feedMeta = priceBundle?.feedMeta



    const disconnectWallet = async () => {
        if (publicKey) {
            await authLogout(publicKey)
        }
        StellarWallet.disconnect()
        onNavigate('landing')
    }


    const performanceData = [
        { date: '1/1', value: 10000 },
        { date: '1/2', value: 10250 },
        { date: '1/3', value: 10100 },
        { date: '1/4', value: 10800 },
        { date: '1/5', value: 11200 },
        { date: '1/6', value: portfolioData?.totalValue || 10000 }
    ]

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
            {/* Header */}
            <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center">
                        <button
                            onClick={() => onNavigate('landing')}
                            className="mr-4 p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Portfolio Dashboard</h1>
                            {publicKey ? (
                                <div className="flex items-center space-x-4 mt-1">
                                    <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                                        <span className="capitalize font-medium">
                                            {walletType} Wallet
                                        </span>
                                        <span>{publicKey.slice(0, 4)}...{publicKey.slice(-4)}</span>
                                    </div>
                                    <div className="flex items-center space-x-1 text-xs text-gray-500 dark:text-gray-500">
                                        <span>Contract:</span>
                                        <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{contractAddress.slice(0, 4)}...{contractAddress.slice(-4)}</code>
                                        <a
                                            href={`https://stellar.expert/explorer/testnet/contract/${contractAddress}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 hover:text-blue-700"
                                        >
                                            <ExternalLink className="w-3 h-3" />
                                        </a>
                                    </div>
                                </div>
                            ) : (
                                <span className="text-sm bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300 px-2 py-1 rounded mt-1 inline-block">
                                    Demo Mode - Connect wallet for full functionality
                                </span>
                            )}
                        </div>
                    </div>


                        </div>

                        {publicKey ? (
                            <>
                                <button
                                    onClick={() => setShowDeleteConfirm(true)}
                                    className="text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 px-3 py-2 text-sm transition-colors flex items-center gap-1"
                                    title="Delete my data (GDPR)"
                                >
                                    <Trash2 className="w-4 h-4" />
                                    Delete my data
                                </button>
                                {portfolioData?.id && portfolioData.id !== 'demo' ? (
                                    <button
                                        onClick={startClonePortfolio}
                                        className="border border-blue-200 dark:border-blue-700 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-800 dark:text-blue-200 px-4 py-2 rounded-lg transition-colors flex items-center gap-1"
                                        title="Copy allocations into a new portfolio"
                                    >
                                        <Copy className="w-4 h-4" />
                                        Clone as new
                                    </button>
                                ) : null}
                                <button
                                    onClick={() => onNavigate('setup')}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
                                >
                                    Create Portfolio
                                </button>
                                <button
                                    onClick={disconnectWallet}
                                    className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 px-3 py-2 text-sm transition-colors"
                                >
                                    Disconnect
                                </button>
                            </>
                        ) : (
                            <>
                                <button
                                    onClick={() => onNavigate('landing')}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
                                >
                                    Connect Wallet
                                </button>
                                {/* NEW: Demo reset button for local testing */}
                                <button

                                    onClick={() => setShowDemoResetConfirm(true)}
                                    className="border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-1"
                                    title="Reset demo portfolio to default state"
                                >
                                    <RefreshCw className="w-4 h-4" />
                                    Reset Demo
                                </button>
                            </>
                        )}
                        <button
                            onClick={refreshData}
                            disabled={loading}
                            className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors disabled:opacity-50"
                        >
                            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>
            </div>


                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {showDemoResetConfirm ? (
                <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
                        <div className="flex items-center gap-2 mb-4">
                            <RefreshCw className="w-6 h-6 text-blue-500 flex-shrink-0" />
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Reset Demo Portfolio</h2>
                        </div>
                        <p className="text-gray-600 dark:text-gray-400 text-sm mb-6">
                            This resets the demo portfolio to its default $10,000 allocation (40% XLM / 60% USDC).
                        </p>
                        <div className="flex justify-end gap-3">
                            <button

                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

n
                {/* Tab Navigation */}
                <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
                    <nav className="flex space-x-8">
                        <button
                            onClick={() => setActiveTab('overview')}
                            className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'overview'
                                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300'
                                }`}
                        >
                            Overview

                                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300'
                                }`}
                        >


                {activeTab === 'analytics' ? (
                    <PerformanceChart portfolioId={portfolioData?.id || null} />
                ) : activeTab === 'notifications' ? (
                    <NotificationPreferences userId={publicKey || 'demo'} portfolioId={portfolioData?.id || null} />
                ) :  (
                    <>
                        {/* Portfolio Overview */}

                            <div className="lg:col-span-2">
                                {/* NEW: Portfolio Value Skeleton Loading State */}
                                {loading ? (
                                    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm animate-pulse">
                                        <div className="flex items-center justify-between mb-6">
                                            <div className="w-32 h-6 bg-gray-300 dark:bg-gray-700 rounded" />
                                            <div className="space-x-2 flex items-center">
                                                <div className="w-32 h-4 bg-gray-300 dark:bg-gray-700 rounded" />
                                                <div className="w-24 h-6 bg-gray-300 dark:bg-gray-700 rounded" />
                                            </div>
                                        </div>
                                        <div className="mb-4 space-y-2">
                                            <div className="w-40 h-8 bg-gray-300 dark:bg-gray-700 rounded" />
                                            <div className="w-32 h-4 bg-gray-300 dark:bg-gray-700 rounded" />
                                        </div>
                                        <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded" />
                                    </div>
                                ) : (
                                    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
                                        <div className="flex items-center justify-between mb-6">
                                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Portfolio Value</h2>
                                            <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
                                                <span>Last updated: just now</span>
                                                <span
                                                    className={`px-2 py-1 rounded text-xs ${
                                                        feedMeta?.degraded || hasPartialPriceData
                                                            ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200'
                                                            : feedMeta?.staleOrLimited
                                                              ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200'
                                                              : hasLivePriceRows
                                                                ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                                                                : 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400'
                                                    }`}
                                                >
                                                    {effectivePriceSource}
                                                </span>
                                            </div>
                                        </div>

                                            <p className="mb-4 text-xs text-amber-800 dark:text-amber-200/90 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
                                                {feedMeta?.degraded
                                                    ? 'Displayed prices are synthetic or fallback — not primary market data.'
                                                    : hasPartialPriceData
                                                      ? partialPriceMessage
                                                      : 'Price feed may be stale or rate-limited; confirm against an exchange if trading.'}
                                            </p>

                                        <div className="mb-4">
                                            <div className="text-3xl font-bold text-gray-900 dark:text-white">
                                                ${portfolioData?.totalValue?.toLocaleString() || '0'}
                                            </div>
                                            <div className="flex items-center mt-1">
                                                <TrendingUp className="w-4 h-4 text-green-500 mr-1" />
                                                <span className="text-green-500 font-medium">+{portfolioData?.dayChange || 0}%</span>
                                                <span className="text-gray-500 dark:text-gray-400 ml-2">Today</span>
                                            </div>
                                        </div>
                                        <div className="h-64">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <LineChart data={performanceData}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#374151' : '#f0f0f0'} />
                                                    <XAxis dataKey="date" stroke={isDark ? '#9CA3AF' : '#666'} />
                                                    <YAxis stroke={isDark ? '#9CA3AF' : '#666'} />
                                                    <Tooltip
                                                        contentStyle={{
                                                            backgroundColor: isDark ? '#1F2937' : '#fff',
                                                            border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                                                            borderRadius: '8px',
                                                            color: isDark ? '#F9FAFB' : '#111827'
                                                        }}
                                                    />
                                                    <Line type="monotone" dataKey="value" stroke="#3B82F6" strokeWidth={3} />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-6">
                                {/* Rebalance Alert */}
                                {portfolioData?.needsRebalance && (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        className="bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-900/30 dark:to-red-900/30 border border-orange-200 dark:border-orange-800 rounded-xl p-6"
                                    >
                                        <div className="flex items-center mb-3">
                                            <AlertCircle className="w-5 h-5 text-orange-500 mr-2" />
                                            <span className="font-medium text-orange-800 dark:text-orange-300">Rebalance Needed</span>
                                        </div>
                                        <p className="text-sm text-orange-700 dark:text-orange-400 mb-2">
                                            Your portfolio has drifted from target allocation
                                        </p>
                                        <p className="text-sm text-orange-700 dark:text-orange-400 mb-2 font-medium">
                                            Estimated gas: {estimateXlm.toFixed(2)} XLM (~${estimateUsd.toFixed(3)})
                                        </p>
                                        <p className="text-xs text-orange-600 dark:text-orange-400 mb-3">
                                            {rebalanceEstimate?.tradeCount ?? 0} estimated trade{(rebalanceEstimate?.tradeCount ?? 0) === 1 ? '' : 's'} @ {(rebalanceEstimate?.gasPerTradeXlm ?? 0).toFixed(4)} XLM each
                                        </p>
                                        {hasHighGasWarning && (
                                            <p className="text-xs text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40 rounded px-2 py-1 mb-3">
                                                Warning: estimated gas is unusually high ({'>'} 0.5 XLM). Consider reducing trade count.
                                            </p>
                                        )}
                                        {(rebalanceEstimate?.breakdown?.length ?? 0) > 0 && (
                                            <div className="text-xs text-orange-700 dark:text-orange-300 mb-3 space-y-1">
                                                {rebalanceEstimate.breakdown.map((item: any) => (
                                                    <div key={item.tradeId} className="flex justify-between">
                                                        <span>{item.tradeId}</span>
                                                        <span>{Number(item.estimateXlm || 0).toFixed(4)} XLM</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {(portfolioData as any)?.slippageTolerancePercent != null && (
                                            <p className="text-xs text-orange-600 dark:text-orange-400 mb-4">
                                                Max slippage: {(portfolioData as any).slippageTolerancePercent}% — trades beyond this will be rejected
                                            </p>
                                        )}
                                        <button

                                            disabled={executeRebalanceMutation.isPending || !publicKey || portfolioData?.id === 'demo'}
                                            className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white py-2 px-4 rounded-lg font-medium transition-colors flex items-center justify-center"
                                        >
                                            {executeRebalanceMutation.isPending ? (
                                                <>
                                                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                                    Rebalancing...
                                                </>
                                            ) : (
                                                'Execute Rebalance'
                                            )}
                                        </button>
                                        {(portfolioData as any)?.slippageTolerance != null && (
                                            <p className="text-xs text-gray-600 dark:text-gray-400 mt-2 text-center">
                                                Max slippage: {(portfolioData as any).slippageTolerance}% — trades above this will be rejected
                                            </p>
                                        )}
                                        {(!publicKey || portfolioData?.id === 'demo') && (
                                            <p className="text-xs text-orange-600 dark:text-orange-400 mt-2 text-center">
                                                {!publicKey ? 'Connect wallet to execute rebalance' : 'Create a real portfolio to enable rebalancing'}
                                            </p>
                                        )}
                                    </motion.div>
                                )}

                                {/* NEW: Allocation Chart Skeleton Loading State */}
                                {loading ? (
                                    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
                                        <div className="w-32 h-6 bg-gray-300 dark:bg-gray-700 rounded mb-4 animate-pulse" />
                                        <div className="h-48 flex items-center justify-center mb-4">
                                            <div className="w-40 h-40 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
                                        </div>
                                        <div className="space-y-3">
                                            {[1, 2, 3].map((i) => (
                                                <div key={i} className="flex items-center justify-between animate-pulse">
                                                    <div className="flex items-center space-x-2">
                                                        <div className="w-3 h-3 rounded-full bg-gray-300 dark:bg-gray-700" />
                                                        <div className="w-20 h-3 bg-gray-300 dark:bg-gray-700 rounded" />
                                                    </div>
                                                    <div className="w-12 h-3 bg-gray-300 dark:bg-gray-700 rounded" />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
                                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Allocation</h3>
                                        <div className="h-48 flex items-center justify-center">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <PieChart>
                                                    <Pie
                                                        data={allocationData}
                                                        cx="50%"
                                                        cy="50%"
                                                        innerRadius={40}
                                                        outerRadius={80}
                                                        paddingAngle={2}
                                                        dataKey="value"
                                                    >
                                                        {allocationData.map((entry: any, index: number) => (
                                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                                        ))}
                                                    </Pie>
                                                </PieChart>
                                            </ResponsiveContainer>
                                        </div>
                                        <div className="mt-4 space-y-2">
                                            {allocationData.map((asset: any, index: number) => (
                                                <div key={index} className="flex items-center justify-between">
                                                    <div className="flex items-center">
                                                        <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: asset.color }}></div>
                                                        <span className="text-sm text-gray-600 dark:text-gray-400">{asset.name}</span>
                                                    </div>
                                                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{asset.value.toFixed(1)}%</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Price Tracker */}
                        <div className="mb-8">
                            <PriceTracker />
                        </div>

                        {/* NEW: Asset Cards Skeleton Loading State */}

                            {loading ? (
                                // Show skeleton cards while loading
                                [1, 2, 3].map((i) => (
                                    <AssetCard key={`skeleton-${i}`} isLoading={true} />
                                ))
                            ) : (
                                // Show actual asset cards when data is loaded
                                allocationData.map((asset: any, index: number) => {
                                    const row = prices[asset.name]

                                    return <AssetCard key={index} asset={asset} price={priceCard} />
                                })
                            )}
                        </div>

                        {/* Rebalance History */}
                        <RebalanceHistory portfolioId={portfolioData?.id || null} />
                    </>
                )}
            </div>

                                disabled={executeRebalanceMutation.isPending || portfolioData?.id === 'demo'}
                                className="bg-orange-600 hover:bg-orange-700 disabled:bg-orange-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1"
                            >
                                {executeRebalanceMutation.isPending ? (
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Zap className="w-4 h-4" />
                                )}
                                Rebalance
                            </button>
                        ) : (
                            <div className="flex items-center gap-1 text-green-600 dark:text-green-400 text-sm">
                                <CheckCircle className="w-4 h-4" />

                                onClick={() => onNavigate('setup')}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-1"
                            >
                                <Plus className="w-4 h-4" />

                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>
            </div>

        </div>
    )
}

export default Dashboard
