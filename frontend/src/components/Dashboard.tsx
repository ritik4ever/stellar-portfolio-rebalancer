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
    useRebalancePlan,
    buildRebalanceConfirmationSummary,
    buildRebalancePreconditions,
    portfolioKeys,
} from '../hooks/queries/usePortfolioQuery'
import { dashboardCopy } from '../content/uiCopy'
import { buildPortfolioCloneDraft, savePortfolioCloneDraft } from '../utils/portfolioCloneDraft'
import { usePrices, formatPriceFeedSummary, priceKeys } from '../hooks/queries/usePricesQuery'
import { useExecuteRebalanceMutation } from '../hooks/mutations/usePortfolioMutations'
import { useQueryClient } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../config/api'
import { logout as authLogout } from '../services/authService'
import RouteErrorState from './RouteErrorState'
import { usePortfolioExport } from '../hooks/usePortfolio'

interface DashboardProps {
    onNavigate: (view: string) => void
    publicKey: string | null
}

type DashboardPriceRow = { price?: number; change?: number; [key: string]: unknown }

const Dashboard: React.FC<DashboardProps> = ({ onNavigate, publicKey }) => {
    const [activeTab, setActiveTab] = useState<'overview' | 'analytics' | 'notifications' | 'test-notifications'>('overview')
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

    const [showRebalanceConfirm, setShowRebalanceConfirm] = useState(false)
    const { data: rebalancePlan, isLoading: rebalancePlanLoading, isError: rebalancePlanError } = useRebalancePlan(
        latestPortfolioId,
        showRebalanceConfirm,
    )

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

    const estimateXlm = rebalanceEstimate?.gasEstimateXlm ?? 0
    const estimateUsd = rebalanceEstimate?.gasEstimateUsd ?? 0
    const hasHighGasWarning = rebalanceEstimate?.gasWarning || estimateXlm > 0.5

    const queryClient = useQueryClient()
    const {
        exportProgress,
        resetExportProgress,
        exportClientCsv,
        exportClientJson,
        exportFromServer,
    } = usePortfolioExport()

    const [showDemoResetConfirm, setShowDemoResetConfirm] = useState(false)
    const [resettingDemo, setResettingDemo] = useState(false)

    const refreshData = useCallback(async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: portfolioKeys.all }),
            queryClient.invalidateQueries({ queryKey: priceKeys.all }),
        ])
    }, [queryClient])

    const retryPortfolioLoad = useCallback(async () => {
        await Promise.all([refetchPortfolios(), refetchPortfolioDetails(), refetchPrices()])
        await refreshData()
    }, [refetchPortfolioDetails, refetchPortfolios, refetchPrices, refreshData])

    const resetDemoPortfolio = useCallback(async () => {
        if (publicKey) return
        setResettingDemo(true)
        try {
            await queryClient.invalidateQueries({ queryKey: portfolioKeys.all })
            await queryClient.invalidateQueries({ queryKey: priceKeys.all })
            await new Promise((resolve) => setTimeout(resolve, 500))
            setShowDemoResetConfirm(false)
        } catch (error) {
            console.error('Demo reset failed:', error)
            alert('Failed to reset demo portfolio. Please refresh the page.')
        } finally {
            setResettingDemo(false)
        }
    }, [publicKey, queryClient])

    const requestRebalance = () => {
        if (!portfolioData?.id || portfolioData.id === 'demo') {
            alert('Rebalancing not available in demo mode. Please create a real portfolio.')
            return
        }
        if (!publicKey) {
            alert('Connect your wallet to execute a rebalance.')
            return
        }
        setShowRebalanceConfirm(true)
    }

    const confirmRebalance = async () => {
        try {
            const result = await executeRebalanceMutation.mutateAsync()
            setShowRebalanceConfirm(false)
            alert(`Rebalance executed successfully! Gas used: ${result.result?.gasUsed || 'N/A'}`)
        } catch (error: unknown) {
            console.error('Rebalance failed:', error)
            const msg = error instanceof Error ? error.message : 'Rebalance failed. Please try again.'
            const isSlippage =
                typeof msg === 'string' &&
                (msg.toLowerCase().includes('slippage') || msg.toLowerCase().includes('tolerance'))
            alert(isSlippage ? `Slippage too high: ${msg}` : msg)
        }
    }

    const disconnectWallet = async () => {
        if (publicKey) {
            await authLogout(publicKey)
        }
        StellarWallet.disconnect()
        onNavigate('landing')
    }

    /** GDPR: Delete all user data from the server, then logout and go to landing */
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const deleteMyData = async () => {
        if (!publicKey) return
        setDeleting(true)
        try {
            await api.delete(ENDPOINTS.USER_DATA_DELETE(publicKey))
            await authLogout(publicKey)
            StellarWallet.disconnect()
            setShowDeleteConfirm(false)
            onNavigate('landing')
        } catch (e) {
            console.error('Delete data failed', e)
            alert(e instanceof Error ? e.message : 'Failed to delete data. Please try again.')
        } finally {
            setDeleting(false)
        }
    }

    // Create allocation data from portfolio data
    const allocationData = portfolioData?.allocations?.map((alloc: any, index: number) => ({
        name: alloc.asset,
        value: alloc.target || alloc.percentage, // Handle both formats
        amount: alloc.amount || 0,
        color: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444'][index] || '#6B7280'
    })) || []

    // If portfolio has allocations object instead of array, convert it
    if (portfolioData?.allocations && typeof portfolioData.allocations === 'object' && !Array.isArray(portfolioData.allocations)) {
        const allocationsArray = Object.entries(portfolioData.allocations).map(([asset, percentage], index) => ({
            name: asset,
            value: percentage as number,
            amount: (portfolioData.totalValue || 10000) * (percentage as number) / 100,
            color: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444'][index] || '#6B7280'
        }))
        allocationData.splice(0, allocationData.length, ...allocationsArray)
    }

    const missingPriceAssets = allocationData.filter((asset) => {
        const row = prices[asset.name]
        return !row || row.price === undefined || row.price === null
    })
    const pricedAssets = allocationData.length - missingPriceAssets.length
    const hasPartialPriceData = pricedAssets > 0 && missingPriceAssets.length > 0
    const partialPriceMessage = hasPartialPriceData
        ? `Some asset quotes are unavailable or fallback-based. ${missingPriceAssets.length} asset${missingPriceAssets.length !== 1 ? 's are' : ' is'} missing fresh market data.`
        : null
    const priceSource = hasLivePriceRows
        ? formatPriceFeedSummary(feedMeta, true, false)
        : publicKey
            ? 'No price data'
            : 'Demo data'
    const effectivePriceSource = hasPartialPriceData ? 'Partial price data' : priceSource
    const showPriceQualityNote = !!(feedMeta?.degraded || feedMeta?.staleOrLimited || hasPartialPriceData)

    const rebalanceTradeoffs = buildRebalanceConfirmationSummary({
        slippageTolerancePercent: (portfolioData as { slippageTolerancePercent?: number })?.slippageTolerancePercent,
        slippageTolerance: (portfolioData as { slippageTolerance?: number })?.slippageTolerance,
        feedMeta,
        hasPartialPriceData,
        partialPriceMessage,
        estimate: rebalanceEstimate,
        hasHighGasWarning,
    })

    const rebalancePreconditions = buildRebalancePreconditions({
        publicKey,
        portfolioId: portfolioData?.id,
        needsRebalance: portfolioData?.needsRebalance,
        hasPartialPriceData,
        feedDegraded: feedMeta?.degraded,
        tradeCount: rebalanceEstimate?.tradeCount ?? 0,
        hasHighGasWarning,
    })

    const rebalanceBlocked = rebalancePreconditions.some(
        (item) => !item.ok && (item.id === 'wallet' || item.id === 'portfolio'),
    )

    const startClonePortfolio = () => {
        if (!portfolioData) return
        const draft = buildPortfolioCloneDraft(portfolioData as Record<string, unknown>)
        if (!draft) {
            alert('Could not build a clone from this portfolio.')
            return
        }
        savePortfolioCloneDraft(draft)
        onNavigate('setup')
    }

    const exportFilenameBase = `portfolio_${publicKey ? publicKey.slice(0, 6) : 'demo'}_${new Date().toISOString()}`

    const buildPortfolioExportRows = () => {
        const rows = (allocationData || []).map((a: any) => {
            const price = prices?.[a.name]?.price ?? ''
            const change = prices?.[a.name]?.change ?? ''
            return {
                asset: a.name,
                targetPct: a.value ?? '',
                amount: a.amount ?? '',
                priceUsd: price,
                change24hPct: change
            }
        })
        return rows
    }

    const exportPortfolioCSV = () => {
        if (!portfolioData) return
        void exportClientCsv({
            rows: buildPortfolioExportRows(),
            csvHeaders: ['asset', 'targetPct', 'amount', 'priceUsd', 'change24hPct'],
            filenameBase: exportFilenameBase,
            jsonPayload: {},
        })
    }

    const exportPortfolioJSON = () => {
        if (!portfolioData) return
        void exportClientJson({
            rows: [],
            csvHeaders: [],
            filenameBase: exportFilenameBase,
            jsonPayload: {
                exportedAt: new Date().toISOString(),
                mode: publicKey ? 'wallet' : 'demo',
                portfolio: portfolioData,
                prices,
            },
        })
    }

    const exportFromApi = async (format: 'json' | 'csv' | 'pdf') => {
        if (!portfolioData?.id || portfolioData.id === 'demo') {
            alert('Connect your wallet and open a portfolio to export full data (JSON/CSV/PDF) from the server.')
            return
        }
        await exportFromServer(portfolioData.id, format)
    }

    const exportBusy = exportProgress.phase === 'preparing' || exportProgress.phase === 'downloading'

    const performanceData = [
        { date: '1/1', value: 10000 },
        { date: '1/2', value: 10250 },
        { date: '1/3', value: 10100 },
        { date: '1/4', value: 10800 },
        { date: '1/5', value: 11200 },
        { date: '1/6', value: portfolioData?.totalValue || 10000 }
    ]

    const walletType = StellarWallet.getWalletType()
    const contractAddress = 'CCQ4LISQJFTZJKQDRJHRLXQ2UML45GVXUECN5NGSQKAT55JKAK2JAX7I'

    if (routeDataUnavailable) {
        return (
            <RouteErrorState
                title="Portfolio data is unavailable"
                message={
                    portfoliosError instanceof Error
                        ? portfoliosError.message
                        : 'We could not load the portfolio list for this wallet.'
                }
                detail={
                    detailsLoadError && detailsError instanceof Error
                        ? `Latest portfolio details also failed to load: ${detailsError.message}`
                        : pricesLoadError
                            ? 'Price data failed to refresh. The retry action will attempt a full refetch.'
                            : 'Retrying will refetch portfolio data and the latest price feed.'
                }
                onRetry={retryPortfolioLoad}
                onBack={() => onNavigate('landing')}
                retryLabel="Retry loading"
                backLabel="Go to landing"
            />
        )
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <div className="text-center">
                    <div className="motion-safe:animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500 mx-auto" role="status" aria-label={dashboardCopy.loadingPortfolio} />
                    <p className="mt-4 text-gray-600 dark:text-gray-400">{dashboardCopy.loadingPortfolio}</p>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
            <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center">
                        <button
                            type="button"
                            onClick={() => onNavigate('landing')}
                            className="mr-4 p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                            aria-label={dashboardCopy.goToLanding}
                        >
                            <ArrowLeft className="w-5 h-5" aria-hidden />
                        </button>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{dashboardCopy.title}</h1>
                            {publicKey ? (
                                <div className="flex items-center space-x-4 mt-1">
                                    <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                                        <span className="capitalize font-medium">
                                            {walletType} {dashboardCopy.walletSuffix}
                                        </span>
                                        <span>{publicKey.slice(0, 4)}...{publicKey.slice(-4)}</span>
                                    </div>
                                    <div className="flex items-center space-x-1 text-xs text-gray-500 dark:text-gray-500">
                                        <span>{dashboardCopy.contractLabel}:</span>
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
                                    {dashboardCopy.demoMode}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center space-x-4">
                        <ThemeToggle />
                        <div className="flex flex-col items-end gap-1">
                            <div className="flex items-center space-x-2">
                                {publicKey && portfolioData?.id && portfolioData.id !== 'demo' ? (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => void exportFromApi('json')}
                                            disabled={exportBusy}
                                            className="border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
                                        >
                                            Export JSON
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void exportFromApi('csv')}
                                            disabled={exportBusy}
                                            className="border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
                                        >
                                            Export CSV
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void exportFromApi('pdf')}
                                            disabled={exportBusy}
                                            className="border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
                                        >
                                            Export PDF
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            type="button"
                                            onClick={exportPortfolioCSV}
                                            disabled={!portfolioData || exportBusy}
                                            className="border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
                                        >
                                            Export CSV
                                        </button>
                                        <button
                                            type="button"
                                            onClick={exportPortfolioJSON}
                                            disabled={!portfolioData || exportBusy}
                                            className="border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
                                        >
                                            Export JSON
                                        </button>
                                        <span className="text-xs text-gray-500 dark:text-gray-400 hidden sm:inline">Connect wallet for full export (PDF + history)</span>
                                    </>
                                )}
                            </div>
                            {exportProgress.phase !== 'idle' ? (
                                <div
                                    className={`max-w-xs rounded-lg border px-3 py-2 text-xs ${
                                        exportProgress.phase === 'error'
                                            ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100'
                                            : exportProgress.phase === 'complete'
                                              ? 'border-green-200 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950/50 dark:text-green-100'
                                              : 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-100'
                                    }`}
                                    role="status"
                                    aria-live="polite"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span>{exportProgress.label}</span>
                                        {exportProgress.phase === 'error' || exportProgress.phase === 'complete' ? (
                                            <button
                                                type="button"
                                                onClick={resetExportProgress}
                                                className="font-medium underline"
                                            >
                                                Dismiss
                                            </button>
                                        ) : (
                                            <RefreshCw className="h-3.5 w-3.5 motion-safe:animate-spin shrink-0" aria-hidden />
                                        )}
                                    </div>
                                    {exportProgress.detail ? (
                                        <p className="mt-1 opacity-90">{exportProgress.detail}</p>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>

                        {publicKey ? (
                            <>
                                <button
                                    type="button"
                                    onClick={() => setShowDeleteConfirm(true)}
                                    className="text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 px-3 py-2 text-sm transition-colors flex items-center gap-1"
                                    title="Delete my data (GDPR)"
                                >
                                    <Trash2 className="w-4 h-4" aria-hidden />
                                    {dashboardCopy.deleteMyData}
                                </button>
                                {portfolioData?.id && portfolioData.id !== 'demo' ? (
                                    <button
                                        type="button"
                                        onClick={startClonePortfolio}
                                        className="border border-blue-200 dark:border-blue-700 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-800 dark:text-blue-200 px-4 py-2 rounded-lg transition-colors flex items-center gap-1"
                                        title="Copy allocations into a new portfolio"
                                    >
                                        <Copy className="w-4 h-4" aria-hidden />
                                        {dashboardCopy.cloneAsNew}
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={() => onNavigate('setup')}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
                                >
                                    {dashboardCopy.createPortfolio}
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
                                <button
                                    type="button"
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
                            <RefreshCw className={`w-5 h-5 ${loading ? 'motion-safe:animate-spin' : ''}`} aria-hidden />
                        </button>
                    </div>
                </div>
            </header>

            {showRebalanceConfirm ? (
                <div
                    className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="rebalance-confirm-title"
                    aria-describedby="rebalance-confirm-intro"
                >
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
                        <h2 id="rebalance-confirm-title" className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                            {dashboardCopy.previewTitle}
                        </h2>
                        <p id="rebalance-confirm-intro" className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                            {dashboardCopy.previewIntro}
                        </p>
                        {rebalancePlanLoading ? (
                            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4" role="status">
                                Loading rebalance plan…
                            </p>
                        ) : null}
                        {rebalancePlanError ? (
                            <p className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 mb-4" role="alert">
                                Could not load the latest rebalance plan. Estimates below may be incomplete.
                            </p>
                        ) : null}
                        <section className="mb-4" aria-labelledby="rebalance-trades-heading">
                            <h3 id="rebalance-trades-heading" className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                                {dashboardCopy.estimatedTradesSection}
                            </h3>
                            {(rebalanceEstimate?.breakdown?.length ?? 0) > 0 ? (
                                <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
                                    {rebalanceEstimate.breakdown.map((item: { tradeId: string; estimateXlm?: number }) => (
                                        <li key={item.tradeId} className="flex justify-between gap-2">
                                            <span>{item.tradeId}</span>
                                            <span>{Number(item.estimateXlm || 0).toFixed(4)} XLM</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-gray-600 dark:text-gray-400">{dashboardCopy.noTradesPlanned}</p>
                            )}
                            {rebalancePlan?.maxSlippagePercent != null ? (
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                                    Portfolio slippage cap: {rebalancePlan.maxSlippagePercent}% (
                                    {rebalancePlan.estimatedSlippageBps} bps)
                                </p>
                            ) : null}
                        </section>
                        <section className="mb-4" aria-labelledby="rebalance-preconditions-heading">
                            <h3 id="rebalance-preconditions-heading" className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                                {dashboardCopy.preconditionsSection}
                            </h3>
                            <ul className="space-y-2">
                                {rebalancePreconditions.map((item) => (
                                    <li
                                        key={item.id}
                                        className={`text-sm rounded-lg px-3 py-2 border ${
                                            item.ok
                                                ? 'border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950/40 dark:text-green-100'
                                                : 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-medium">{item.label}</span>
                                            <span className="text-xs uppercase tracking-wide">
                                                {item.ok ? dashboardCopy.preconditionMet : dashboardCopy.preconditionBlocked}
                                            </span>
                                        </div>
                                        {item.detail ? <p className="mt-1 text-xs opacity-90">{item.detail}</p> : null}
                                    </li>
                                ))}
                            </ul>
                        </section>
                        <section className="mb-4" aria-labelledby="rebalance-slippage-heading">
                            <h3 id="rebalance-slippage-heading" className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                                {dashboardCopy.slippageSection}
                            </h3>
                            <ul className="list-disc pl-5 text-sm text-gray-700 dark:text-gray-300 space-y-1">
                                {rebalanceTradeoffs.slippage.map((line) => (
                                    <li key={line}>{line}</li>
                                ))}
                            </ul>
                        </section>
                        <section className="mb-4" aria-labelledby="rebalance-prices-heading">
                            <h3 id="rebalance-prices-heading" className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                                {dashboardCopy.pricesSection}
                            </h3>
                            <ul className="list-disc pl-5 text-sm text-gray-700 dark:text-gray-300 space-y-1">
                                {rebalanceTradeoffs.prices.map((line) => (
                                    <li key={line}>{line}</li>
                                ))}
                            </ul>
                        </section>
                        <section className="mb-6" aria-labelledby="rebalance-risk-heading">
                            <h3 id="rebalance-risk-heading" className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                                {dashboardCopy.riskSection}
                            </h3>
                            <ul className="list-disc pl-5 text-sm text-gray-700 dark:text-gray-300 space-y-1">
                                {rebalanceTradeoffs.risks.map((line) => (
                                    <li key={line}>{line}</li>
                                ))}
                            </ul>
                        </section>
                        <div className="flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setShowRebalanceConfirm(false)}
                                disabled={executeRebalanceMutation.isPending}
                                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                            >
                                {dashboardCopy.cancel}
                            </button>
                            <button
                                type="button"
                                onClick={() => void confirmRebalance()}
                                disabled={executeRebalanceMutation.isPending || rebalanceBlocked}
                                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-orange-400 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                            >
                                {executeRebalanceMutation.isPending ? (
                                    <>
                                        <RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden />
                                        {dashboardCopy.rebalancing}
                                    </>
                                ) : (
                                    dashboardCopy.confirmRebalance
                                )}
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
                                type="button"
                                onClick={() => setShowDemoResetConfirm(false)}
                                disabled={resettingDemo}
                                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => void resetDemoPortfolio()}
                                disabled={resettingDemo}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                            >
                                {resettingDemo ? (
                                    <>
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                        Resetting…
                                    </>
                                ) : (
                                    'Reset Demo'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            {showDeleteConfirm && (
                <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
                        <div className="flex items-center gap-2 mb-4">
                            <AlertCircle className="w-6 h-6 text-amber-500 flex-shrink-0" />
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Delete my data</h2>
                        </div>
                        <p className="text-gray-600 dark:text-gray-400 text-sm mb-6">
                            This will permanently delete your consent records, all portfolios, and rebalance history from our servers. You will be signed out. This action cannot be undone.
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setShowDeleteConfirm(false)}
                                disabled={deleting}
                                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={deleteMyData}
                                disabled={deleting}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                            >
                                {deleting ? (
                                    <>
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                        Deleting...
                                    </>
                                ) : (
                                    <>
                                        <Trash2 className="w-4 h-4" />
                                        Delete all my data
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <main className="p-6 max-w-7xl mx-auto" id="dashboard-main">
                <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
                    <nav className="flex space-x-8" aria-label="Dashboard sections">
                        <button
                            onClick={() => setActiveTab('overview')}
                            className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'overview'
                                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300'
                                }`}
                        >
                            {dashboardCopy.overviewTab}
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('analytics')}
                            className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'analytics'
                                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300'
                                }`}
                        >
                            {dashboardCopy.analyticsTab}
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('notifications')}
                            className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'notifications'
                                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300'
                                }`}
                        >
                            {dashboardCopy.notificationsTab}
                        </button>
                    </nav>
                </div>

                {/* Debug Info */}
                {(import.meta as any).env?.DEV && (
                    <div className="bg-gray-100 dark:bg-gray-800 p-2 rounded mb-4 text-xs dark:text-gray-300">
                        <div>Portfolio ID: {portfolioData?.id}</div>
                        <div>Allocations: {JSON.stringify(allocationData)}</div>
                        <div>Price Source: {effectivePriceSource}</div>
                    </div>
                )}

                {activeTab === 'analytics' ? (
                    <PerformanceChart portfolioId={portfolioData?.id || null} />
                ) : activeTab === 'notifications' ? (
                    <NotificationPreferences userId={publicKey || 'demo'} portfolioId={portfolioData?.id || null} />
                ) :  (
                    <>
                        {/* Portfolio Overview */}
                        <div className="grid lg:grid-cols-3 gap-6 mb-8">
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
                                        {showPriceQualityNote ? (
                                            <p className="mb-4 text-xs text-amber-800 dark:text-amber-200/90 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
                                                {feedMeta?.degraded
                                                    ? 'Displayed prices are synthetic or fallback — not primary market data.'
                                                    : hasPartialPriceData
                                                      ? partialPriceMessage
                                                      : 'Price feed may be stale or rate-limited; confirm against an exchange if trading.'}
                                            </p>
                                        ) : null}
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
                                        initial={false}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ duration: 0.2 }}
                                        className="motion-safe:transition-transform bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-900/30 dark:to-red-900/30 border border-orange-200 dark:border-orange-800 rounded-xl p-6"
                                        role="status"
                                        aria-live="polite"
                                    >
                                        <div className="flex items-center mb-3">
                                            <AlertCircle className="w-5 h-5 text-orange-500 mr-2" />
                                            <span className="font-medium text-orange-800 dark:text-orange-300">{dashboardCopy.rebalanceNeeded}</span>
                                        </div>
                                        <p className="text-sm text-orange-700 dark:text-orange-400 mb-2">
                                            {dashboardCopy.driftMessage}
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
                                            type="button"
                                            onClick={requestRebalance}
                                            disabled={executeRebalanceMutation.isPending || !publicKey || portfolioData?.id === 'demo'}
                                            className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white py-2 px-4 rounded-lg font-medium transition-colors flex items-center justify-center"
                                        >
                                            {executeRebalanceMutation.isPending ? (
                                                <>
                                                    <RefreshCw className="w-4 h-4 mr-2 motion-safe:animate-spin" aria-hidden />
                                                    {dashboardCopy.rebalancing}
                                                </>
                                            ) : (
                                                dashboardCopy.executeRebalance
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
                        <div className="grid lg:grid-cols-3 gap-6 mb-8">
                            {loading ? (
                                // Show skeleton cards while loading
                                [1, 2, 3].map((i) => (
                                    <AssetCard key={`skeleton-${i}`} isLoading={true} />
                                ))
                            ) : (
                                // Show actual asset cards when data is loaded
                                allocationData.map((asset: any, index: number) => {
                                    const row = prices[asset.name]
                                    const priceCard = row
                                        ? {
                                              price: typeof row === 'number' ? row : row.price ?? null,
                                              change: typeof row === 'number' ? 0 : row.change ?? null,
                                              source:
                                                  typeof row === 'object' && row !== null
                                                      ? (row.source as string | undefined)
                                                      : undefined,
                                          }
                                        : undefined
                                    return <AssetCard key={index} asset={asset} price={priceCard} />
                                })
                            )}
                        </div>

                        {/* Rebalance History */}
                        <RebalanceHistory portfolioId={portfolioData?.id || null} />
                    </>
                )}
            </main>

            <div className="mobile-action-bar fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4 md:hidden z-40" aria-label="Quick portfolio actions">
                <div className="flex items-center justify-between max-w-sm mx-auto">
                    <div className="text-center">
                        <div className="text-xs text-gray-500 dark:text-gray-400">{dashboardCopy.totalValue}</div>
                        <div className="text-lg font-bold text-gray-900 dark:text-white">
                            ${portfolioData?.totalValue?.toLocaleString() || '10,000'}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {portfolioData?.needsRebalance ? (
                            <button
                                type="button"
                                onClick={requestRebalance}
                                disabled={executeRebalanceMutation.isPending || portfolioData?.id === 'demo'}
                                className="bg-orange-600 hover:bg-orange-700 disabled:bg-orange-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1"
                            >
                                {executeRebalanceMutation.isPending ? (
                                    <RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden />
                                ) : (
                                    <Zap className="w-4 h-4" aria-hidden />
                                )}
                                {dashboardCopy.rebalance}
                            </button>
                        ) : (
                            <div className="flex items-center gap-1 text-green-600 dark:text-green-400 text-sm">
                                <CheckCircle className="w-4 h-4" />
                                <span>{dashboardCopy.balanced}</span>
                            </div>
                        )}
                        {publicKey ? (
                            <button
                                type="button"
                                onClick={() => onNavigate('setup')}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-1"
                            >
                                <Plus className="w-4 h-4" />
                                {dashboardCopy.newPortfolio}
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setShowDemoResetConfirm(true)}
                                className="border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm"
                            >
                                <RefreshCw className="w-4 h-4" />
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => void refreshData()}
                            disabled={loading}
                            className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 disabled:opacity-50"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'motion-safe:animate-spin' : ''}`} aria-hidden />
                        </button>
                    </div>
                </div>
            </div>
            <div className="h-20 md:hidden" />
        </div>
    )
}

export default Dashboard
