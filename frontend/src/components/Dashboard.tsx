import React, { useState, useCallback, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, AlertCircle, RefreshCw, ArrowLeft, ExternalLink, Trash2, Plus, CheckCircle, Copy, Share2, Settings, WalletCards } from 'lucide-react'
import ThemeToggle from './ThemeToggle'
import LanguageSelector from './LanguageSelector'
import { useTheme } from '../context/ThemeContext'
import AssetList from './AssetList'
import RebalanceHistory from './RebalanceHistory'
import RebalanceConfirm from './RebalanceConfirm'
import PerformanceChart from './PerformanceChart'
import AllocationHistory from './AllocationHistory'
import NotificationPreferences from './NotificationPreferences'
import { StellarWallet } from '../utils/stellar'
import PriceTracker from './PriceTracker'
import PriceTicker from './PriceTicker'
import ExportPDF from './ExportPDF'

import { API_CONFIG } from '../config/api'
import { marketMoversKeys } from '../hooks/queries/useMarketMoversQuery'
import { useUserPortfolios, usePortfolioDetails, isUnavailablePortfolio, usePortfolioCostSummary, portfolioKeys } from '../hooks/queries/usePortfolioQuery'
import { dashboardCopy } from '../content/uiCopy'
import { buildPortfolioCloneDraft, savePortfolioCloneDraft } from '../utils/portfolioCloneDraft'
import { usePrices, formatPriceFeedSummary, priceKeys } from '../hooks/queries/usePricesQuery'
import { useQueryClient } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../config/api'
import { logout as authLogout } from '../services/authService'
import RouteErrorState from './RouteErrorState'
import { downloadCSV, downloadJSON, toCSV } from '../utils/export'
import { downloadPortfolioExport } from '../config/api'
import { usePortfolioLiveFeed } from '../hooks/usePortfolioLiveFeed'
import { DriftGaugeGrid, type DriftGaugeAsset } from './DriftGauge'
import { trackEvent } from '../analytics'
import { useDialogFocus } from '../hooks/useDialogFocus'
import PriceCandlestick, { type RebalanceEvent as CandlestickRebalanceEvent } from './PriceCandlestick'

interface DashboardProps {
    onNavigate: (view: string) => void
    publicKey: string | null
}

type DashboardPriceRow = { price?: number; change?: number;[key: string]: unknown }

const Dashboard: React.FC<DashboardProps> = ({ onNavigate, publicKey }) => {
    const [activeTab, setActiveTab] = useState<'overview' | 'analytics' | 'notifications'>('overview')
    // Polite screen-reader announcements for navigation and wallet-state changes.
    const [navAnnouncement, setNavAnnouncement] = useState('')
    const selectTab = useCallback((tab: 'overview' | 'analytics' | 'notifications', label: string) => {
        setActiveTab(tab)
        setNavAnnouncement(`${label} section shown`)
    }, [])
    const [reviewPortfolioId, setReviewPortfolioId] = useState<string | null>(null)
    const [rebalanceNotice, setRebalanceNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
    const [candlestickAsset, setCandlestickAsset] = useState<string>('XLM')

    const headingRef = useRef<HTMLHeadingElement>(null)
    const { isDark } = useTheme()
    const queryClient = useQueryClient()

    const {
        data: portfolios,
        isLoading: portfoliosLoading,
        isError: portfoliosLoadError,
        error: portfoliosError,
        refetch: refetchPortfolios,
    } = useUserPortfolios(publicKey)

    const latestPortfolioId = portfolios && portfolios.length > 0
        ? portfolios[portfolios.length - 1].id
        : null

    const {
        data: portfolioDetails,
        isLoading: detailsLoading,
        isError: detailsLoadError,
        isFetching: detailsFetching,
        error: detailsError,
        refetch: refetchPortfolioDetails,
    } = usePortfolioDetails(latestPortfolioId)

    const { connectionState: liveFeedState } = usePortfolioLiveFeed(latestPortfolioId || null)

    const {
        data: priceBundle,
        isLoading: pricesLoading,
        isError: pricesLoadError,
        refetch: refetchPrices,
    } = usePrices()
    const { data: costSummary, isLoading: costSummaryLoading } = usePortfolioCostSummary(latestPortfolioId)

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

    const portfolioUnavailable = Boolean(latestPortfolioId && isUnavailablePortfolio(detailsError))
    const balancesPending = Boolean(latestPortfolioId && detailsLoading)
    const balancesFailed = Boolean(latestPortfolioId && detailsLoadError && !portfolioDetails)
    const balancesUnavailable = balancesPending || balancesFailed
    const portfolioSummary = portfolios?.[portfolios.length - 1]
    const portfolioData = publicKey
        ? (portfolioDetails ? { ...portfolioSummary, ...portfolioDetails } : portfolioSummary)
        : demoData
    const priceRows = priceBundle?.prices ?? {}
    const hasLivePriceRows = typeof priceRows === 'object' && Object.keys(priceRows).length > 0
    const prices: Record<string, DashboardPriceRow> = hasLivePriceRows
        ? (priceRows as Record<string, DashboardPriceRow>)
        : demoPrices

    const loading = publicKey ? (portfoliosLoading || (!latestPortfolioId && !API_CONFIG.USE_BROWSER_PRICES && pricesLoading)) : false
    const routeDataUnavailable = Boolean(
        publicKey &&
        portfoliosLoadError &&
        !portfoliosLoading &&
        (!portfolios || portfolios.length === 0)
    )

    const allocations = portfolioData?.allocations
    const allocationData = Array.isArray(allocations) ? allocations.map((alloc: any, index: number) => ({
        name: alloc.asset,
        value: alloc.target || alloc.percentage,
        amount: alloc.amount || 0,
        color: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444'][index] || '#6B7280'
    })) : []

    if (portfolioData?.allocations && typeof portfolioData.allocations === 'object' && !Array.isArray(portfolioData.allocations)) {
        const allocationsArray = Object.entries(portfolioData.allocations).map(([asset, percentage], index) => ({
            name: asset,
            value: percentage as number,
            amount: (balancesUnavailable ? 0 : (portfolioData.totalValue ?? 0)) * (percentage as number) / 100,
            color: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444'][index] || '#6B7280'
        }))
        allocationData.splice(0, allocationData.length, ...allocationsArray)
    }

    // Build drift gauge data — map target % and live current % per asset.
    // "current" comes from portfolio allocations when available; falls back to target
    // so the gauge still renders (showing 0 drift) before live data arrives.
    const driftGaugeAssets: DriftGaugeAsset[] = allocationData.map((asset: any) => {
        // portfolioData.allocations may be an array of { asset, target, current } or
        // an object { assetSymbol: pct }. Resolve current from the raw portfolio data.
        let current: number = asset.value // default: same as target (0 drift)
        const rawAlloc = portfolioData?.allocations
        if (Array.isArray(rawAlloc)) {
            const match = rawAlloc.find((a: any) => (a.asset ?? a.name) === asset.name)
            if (match) {
                current = typeof match.current === 'number' ? match.current : asset.value
            }
        }
        const threshold =
            typeof (portfolioData as any)?.threshold === 'number'
                ? (portfolioData as any).threshold
                : 5 // sane default
        const rawTimestamp = (prices as Record<string, any>)?.[asset.name]?.timestamp
        const asOfMs = typeof rawTimestamp === 'number' && Number.isFinite(rawTimestamp)
            ? (rawTimestamp < 1e12 ? rawTimestamp * 1000 : rawTimestamp)
            : priceBundle?.feedMeta?.resolvedAtMs
        return { name: asset.name, target: asset.value, current, threshold, asOf: asOfMs }
    })

    const missingPriceAssets = allocationData.filter((asset: any) => {        const row = prices[asset.name]
        return !row || row.price === undefined || row.price === null
    })
    const pricedAssets = allocationData.length - missingPriceAssets.length
    const hasPartialPriceData = pricedAssets > 0 && missingPriceAssets.length > 0
    const partialPriceMessage = hasPartialPriceData
        ? `Some asset quotes are unavailable or fallback-based. ${missingPriceAssets.length} asset${missingPriceAssets.length !== 1 ? 's are' : ' is'} missing fresh market data.`
        : null

    const priceSource = hasLivePriceRows
        ? formatPriceFeedSummary(priceBundle?.feedMeta, true, false)
        : publicKey
            ? 'No price data'
            : 'Demo data'
    const effectivePriceSource = hasPartialPriceData
        ? 'Partial price data'
        : priceSource
    const feedMeta = priceBundle?.feedMeta
    const showPriceQualityNote = feedMeta?.degraded || hasPartialPriceData || feedMeta?.staleOrLimited

    const refreshData = useCallback(async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: portfolioKeys.all }),
            queryClient.invalidateQueries({ queryKey: priceKeys.all }),
            queryClient.invalidateQueries({ queryKey: marketMoversKeys.all }),
        ])
    }, [queryClient])

    const retryPortfolioLoad = useCallback(async () => {
        await Promise.all([
            refetchPortfolios(),
            refetchPortfolioDetails(),
            refetchPrices(),
        ])
        await refreshData()
    }, [refetchPortfolioDetails, refetchPortfolios, refetchPrices, refreshData])

    const handleRebalanceSuccess = (result: { txId?: string; result?: { gasUsed?: string } }) => {
        trackEvent('rebalance_executed', { portfolioId: latestPortfolioId ?? 'unknown' })
        const txIdPart = result.txId ? ` · TX: ${result.txId}` : ''
        setRebalanceNotice({
            type: 'success',
            message: `Rebalance executed successfully. Gas used: ${result.result?.gasUsed || 'N/A'}${txIdPart}`,
        })
    }

    const dismissRebalanceNotice = useCallback(() => {
        setRebalanceNotice(null)
    }, [])

    React.useEffect(() => {
        if (!rebalanceNotice) return
        const timer = setTimeout(() => setRebalanceNotice(null), 5000)
        return () => clearTimeout(timer)
    }, [rebalanceNotice])

    type DemoResetStep = 'portfolios' | 'prices'
    const [showDemoResetConfirm, setShowDemoResetConfirm] = useState(false)
    const [resettingDemo, setResettingDemo] = useState(false)
    const [demoResetError, setDemoResetError] = useState<{
        failedStep: DemoResetStep
        completedSteps: DemoResetStep[]
        message: string
    } | null>(null)
    const demoResetInFlightRef = React.useRef(false)

    const closeDemoResetModal = useCallback(() => {
        if (resettingDemo) return
        setShowDemoResetConfirm(false)
        setDemoResetError(null)
    }, [resettingDemo])

    // Dialog focus management for the demo reset confirmation.
    const demoResetDialogRef = useRef<HTMLDivElement>(null)
    const demoResetInitialFocusRef = useRef<HTMLButtonElement>(null)
    const mobileRefreshRef = useRef<HTMLButtonElement>(null)
    useDialogFocus(showDemoResetConfirm, demoResetDialogRef, {
        onClose: closeDemoResetModal,
        initialFocusRef: demoResetInitialFocusRef,
        fallbackFocusRef: mobileRefreshRef,
    })

    // The demo reset only applies without a wallet. If a wallet connects (or
    // disconnects) while the dialog or the action bar is in use, close the
    // dialog that no longer applies and announce what changed, instead of
    // leaving a dead dialog or silently re-labelled controls.
    const prevHasWalletRef = useRef(Boolean(publicKey))
    useEffect(() => {
        const hasWallet = Boolean(publicKey)
        if (prevHasWalletRef.current === hasWallet) return
        prevHasWalletRef.current = hasWallet
        if (hasWallet) {
            setShowDemoResetConfirm(false)
            setDemoResetError(null)
            setNavAnnouncement('Wallet connected. Portfolio actions updated.')
        } else {
            setNavAnnouncement('Wallet disconnected. Showing the demo portfolio.')
        }
    }, [publicKey])

    // Refreshing swaps the whole dashboard for the loading screen, which unmounts
    // the control the user just activated. Put keyboard focus back on a Refresh
    // control once the dashboard returns, rather than leaving it on <body>.
    const desktopRefreshRef = useRef<HTMLButtonElement>(null)
    const restoreRefreshFocusRef = useRef(false)
    const handleRefreshClick = useCallback(() => {
        restoreRefreshFocusRef.current = true
        return refreshData()
    }, [refreshData])
    useEffect(() => {
        if (loading || !restoreRefreshFocusRef.current) return
        restoreRefreshFocusRef.current = false
        if (document.activeElement && document.activeElement !== document.body) return
        const candidates = [mobileRefreshRef.current, desktopRefreshRef.current]
        const visible = candidates.find(el => el && el.offsetParent !== null)
        ;(visible ?? candidates.find(Boolean))?.focus()
    }, [loading])

    const resetDemoPortfolio = useCallback(async () => {
        if (publicKey || demoResetInFlightRef.current) return
        demoResetInFlightRef.current = true
        setResettingDemo(true)

        const completed: DemoResetStep[] = demoResetError ? [...demoResetError.completedSteps] : []
        const steps: { id: DemoResetStep; run: () => Promise<void> }[] = [
            {
                id: 'portfolios',
                run: () => queryClient.invalidateQueries({ queryKey: portfolioKeys.all }),
            },
            {
                id: 'prices',
                run: () => queryClient.invalidateQueries({ queryKey: priceKeys.all }),
            },
        ]

        try {
            for (const step of steps) {
                if (completed.includes(step.id)) continue
                try {
                    await step.run()
                    completed.push(step.id)
                } catch (error) {
                    console.error(`Demo reset failed at step "${step.id}":`, error)
                    const detail = error instanceof Error && error.message ? error.message : 'Unexpected error'
                    setDemoResetError({
                        failedStep: step.id,
                        completedSteps: [...completed],
                        message: detail,
                    })
                    return
                }
            }
            setDemoResetError(null)
            await new Promise(resolve => setTimeout(resolve, 500))
            setShowDemoResetConfirm(false)
        } finally {
            demoResetInFlightRef.current = false
            setResettingDemo(false)
        }
    }, [demoResetError, publicKey, queryClient])

    const disconnectWallet = async () => {
        if (publicKey) {
            await authLogout(publicKey)
        }
        StellarWallet.disconnect()
        onNavigate('landing')
    }

    const [shareLink, setShareLink] = useState<string | null>(null)
    const [showSharePopup, setShowSharePopup] = useState(false)
    const [shareLinkLoading, setShareLinkLoading] = useState(false)
    const [shareLinkError, setShareLinkError] = useState<string | null>(null)

    const fetchShareStatus = useCallback(async () => {
        if (!portfolioData?.id || portfolioData.id === 'demo') return
        try {
            const res = await api.get<{ active: boolean; hash?: string }>(ENDPOINTS.PORTFOLIO_SHARE(portfolioData.id))
            if (res.active && res.hash) {
                setShareLink(res.hash)
            } else {
                setShareLink(null)
            }
        } catch {
            setShareLink(null)
        }
    }, [portfolioData])

    React.useEffect(() => {
        if (showSharePopup) {
            fetchShareStatus()
        }
    }, [showSharePopup, fetchShareStatus])

    const createShareLink = useCallback(async () => {
        if (!portfolioData?.id || portfolioData.id === 'demo') return
        setShareLinkLoading(true)
        setShareLinkError(null)
        try {
            const res = await api.post<{ hash: string; active: boolean }>(ENDPOINTS.PORTFOLIO_SHARE(portfolioData.id))
            setShareLink(res.hash)
        } catch (err: any) {
            setShareLinkError(err.message || 'Failed to create share link')
        } finally {
            setShareLinkLoading(false)
        }
    }, [portfolioData])

    const revokeShareLink = useCallback(async () => {
        if (!portfolioData?.id || portfolioData.id === 'demo') return
        setShareLinkLoading(true)
        setShareLinkError(null)
        try {
            await api.delete(ENDPOINTS.PORTFOLIO_SHARE(portfolioData.id))
            setShareLink(null)
        } catch (err: any) {
            setShareLinkError(err.message || 'Failed to revoke share link')
        } finally {
            setShareLinkLoading(false)
        }
    }, [portfolioData])

    const copyShareLinkToClipboard = useCallback(() => {
        if (!shareLink) return
        const url = `${window.location.origin}/public/${shareLink}`
        navigator.clipboard.writeText(url).catch(() => {})
    }, [shareLink])

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

    const startClonePortfolio = useCallback(() => {
        if (portfolioData?.id && portfolioData.id !== 'demo') {
            const draft = buildPortfolioCloneDraft(portfolioData)
            if (draft) {
                savePortfolioCloneDraft(draft)
                onNavigate('setup')
            }
        }
    }, [portfolioData, onNavigate])

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
        const rows = buildPortfolioExportRows()
        const csv = toCSV(rows, ['asset', 'targetPct', 'amount', 'priceUsd', 'change24hPct'])
        const filename = `portfolio_${publicKey ? publicKey.slice(0, 6) : 'demo'}_${new Date().toISOString()}.csv`
        downloadCSV(filename, csv)
    }

    const exportPortfolioJSON = () => {
        if (!portfolioData) return
        const filename = `portfolio_${publicKey ? publicKey.slice(0, 6) : 'demo'}_${new Date().toISOString()}.json`
        downloadJSON(filename, {
            exportedAt: new Date().toISOString(),
            mode: publicKey ? 'wallet' : 'demo',
            portfolio: portfolioData,
            prices
        })
    }

    const exportFromApi = async (format: 'json' | 'csv' | 'pdf') => {
        if (!portfolioData?.id || portfolioData.id === 'demo') {
            alert('Connect your wallet and open a portfolio to export full data (JSON/CSV/PDF) from the server.')
            return
        }
        try {
            await downloadPortfolioExport(portfolioData.id, format)
        } catch (e) {
            console.error('Export failed', e)
            alert(e instanceof Error ? e.message : 'Export failed. Please try again.')
        }
    }

    const performanceData = [
        { date: '1/1', value: 10000 },
        { date: '1/2', value: 10250 },
        { date: '1/3', value: 10100 },
        { date: '1/4', value: 10800 },
        { date: '1/5', value: 11200 },
        { date: '1/6', value: portfolioData?.totalValue ?? 0 }
    ]

    const walletType = StellarWallet.getWalletType()
    const contractAddress = 'CCQ4LISQJFTZJKQDRJHRLXQ2UML45GVXUECN5NGSQKAT55JKAK2JAX7I'

    if (portfolioUnavailable) {
        return (
            <RouteErrorState
                title="Portfolio unavailable"
                message="This portfolio was deleted or you no longer have access."
                detail="Reload the portfolio list to find another portfolio, or return to the landing page."
                onRetry={() => {
                    void refetchPortfolios()
                    void refetchPortfolioDetails()
                }}
                onBack={() => onNavigate('landing')}
                retryLabel="Reload portfolio list"
                backLabel="Go to landing"
                loading={portfoliosLoading}
                focusHeading
            />
        )
    }

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500 mx-auto"></div>
                    <p role="status" className="mt-4 text-gray-600 dark:text-gray-400">Loading portfolio data...</p>
                </div>
            </div>
        )
    }

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

    return (
        <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
            {latestPortfolioId && reviewPortfolioId === latestPortfolioId && !balancesUnavailable && (
                <RebalanceConfirm
                    key={latestPortfolioId}
                    portfolioId={latestPortfolioId}
                    open
                    onClose={() => setReviewPortfolioId(null)}
                    onSuccess={handleRebalanceSuccess}
                />
            )}
            {rebalanceNotice && (
                <div className="fixed inset-x-3 top-3 sm:inset-x-auto sm:right-4 sm:top-4 z-50 sm:max-w-md rounded-lg border bg-white dark:bg-gray-800 shadow-lg p-3 break-words min-w-0">
                    <div role="status" className={`text-sm ${rebalanceNotice.type === 'success' ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
                        {rebalanceNotice.message}
                    </div>
                    <button
                        onClick={dismissRebalanceNotice}
                        className="mt-2 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    >
                        Dismiss
                    </button>
                </div>
            )}

            {/* Header */}
            <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-3 sm:px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3 min-w-0">
                    <div className="flex items-center min-w-0">
                        <button
                            type="button"
                            onClick={() => onNavigate('landing')}
                            className="mr-3 sm:mr-4 p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors flex-shrink-0"
                            aria-label={dashboardCopy.goToLanding}
                        >
                            <ArrowLeft className="w-5 h-5" aria-hidden />
                        </button>
                        <div className="min-w-0">
                            <h1 ref={headingRef} tabIndex={-1} className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white break-words">{dashboardCopy.title}</h1>
                            {publicKey ? (
                                <div className="flex flex-wrap items-center gap-2 sm:gap-4 mt-1">
                                    <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                                        <span className="capitalize font-medium">{walletType} Wallet</span>
                                        <span>{publicKey.slice(0, 4)}...{publicKey.slice(-4)}</span>
                                    </div>
                                    <div className="flex items-center space-x-1 text-xs text-gray-600 dark:text-gray-400">
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
                                    {dashboardCopy.demoMode}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 sm:gap-4 min-w-0">
                        <button
                            type="button"
                            onClick={() => onNavigate('analytics')}
                            className="rounded-lg px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            title="View portfolio analytics"
                        >
                            Analytics
                        </button>
                        <button
                            type="button"
                            onClick={() => onNavigate('tax-report')}
                            className="rounded-lg px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            title="View tax report"
                        >
                            Tax Report
                        </button>
                        <button
                            type="button"
                            onClick={() => onNavigate('settings')}
                            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200 transition-colors"
                            aria-label="Settings"
                            title="Settings"
                        >
                            <Settings className="h-5 w-5" aria-hidden />
                        </button>
                        <ThemeToggle />
                        <LanguageSelector publicKey={publicKey} />
                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 min-w-0">
                            {publicKey && portfolioData?.id && portfolioData.id !== 'demo' ? (
                                <>
                                    <button onClick={() => exportFromApi('json')}
                                        className="border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm transition-colors">Export JSON</button>
                                    <button onClick={() => exportFromApi('csv')}
                                        className="border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm transition-colors">Export CSV</button>
                                    <button onClick={() => exportFromApi('pdf')}
                                        className="border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm transition-colors">Export PDF</button>
                                    <ExportPDF
                                        portfolioData={portfolioData as any}
                                        allocationData={allocationData}
                                        prices={prices}
                                        performanceData={performanceData}
                                        publicKey={publicKey}
                                    />
                                </>
                            ) : (
                                <>
                                    <button onClick={exportPortfolioCSV} disabled={!portfolioData}
                                        className="border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50">Export CSV</button>
                                    <button onClick={exportPortfolioJSON} disabled={!portfolioData}
                                        className="border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50">Export JSON</button>
                                    <ExportPDF
                                        portfolioData={portfolioData as any}
                                        allocationData={allocationData}
                                        prices={prices}
                                        performanceData={performanceData}
                                        publicKey={publicKey}
                                    />
                                    <span className="text-xs text-gray-500 dark:text-gray-400 hidden sm:inline">Connect wallet for full export (PDF + history)</span>
                                </>
                            )}
                        </div>

                        {publicKey ? (
                            <>
                                <button type="button" onClick={() => setShowDeleteConfirm(true)}
                                    className="text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 px-3 py-2 text-sm transition-colors flex items-center gap-1"
                                    title="Delete my data (GDPR)">
                                    <Trash2 className="w-4 h-4" aria-hidden />
                                    {dashboardCopy.deleteMyData}
                                </button>
                                {portfolioData?.id && portfolioData.id !== 'demo' ? (
                                    <button type="button" onClick={startClonePortfolio}
                                        className="border border-blue-200 dark:border-blue-700 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-800 dark:text-blue-300 px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-1"
                                        title="Copy allocations into a new portfolio">
                                        <Copy className="w-4 h-4" aria-hidden />
                                        {dashboardCopy.cloneAsNew}
                                    </button>
                                ) : null}
                                {portfolioData?.id && portfolioData.id !== 'demo' ? (
                                    <button type="button" onClick={() => setShowSharePopup(true)}
                                        className="border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-1">
                                        <Share2 className="w-4 h-4" aria-hidden />
                                        {shareLink ? 'Sharing' : 'Share'}
                                    </button>
                                ) : null}
                                <button type="button" onClick={() => onNavigate('wizard')}
                                    className="border border-blue-600 text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-500 dark:hover:bg-blue-900/20 px-4 py-2 rounded-lg transition-colors text-sm font-medium"
                                    title="Use step-by-step wizard to create a portfolio">
                                    ✨ Wizard
                                </button>
                                <button type="button" onClick={() => onNavigate('setup')}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors">
                                    {dashboardCopy.createPortfolio}
                                </button>
                                <button onClick={disconnectWallet}
                                    className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 px-3 py-2 text-sm transition-colors">
                                    Disconnect
                                </button>
                            </>
                        ) : (
                            <>
                                <button type="button" onClick={() => onNavigate('landing')}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap min-w-0">
                                    Connect Wallet
                                </button>
                                <button type="button" onClick={() => setShowDemoResetConfirm(true)}
                                    aria-label="Reset demo portfolio"
                                    className="border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-1 whitespace-nowrap min-w-0">
                                    <RefreshCw className="w-4 h-4 flex-shrink-0" aria-hidden />
                                    <span>Reset Demo</span>
                                </button>
                            </>
                        )}
                        <button ref={desktopRefreshRef} type="button" onClick={handleRefreshClick} disabled={loading}
                            aria-label="Refresh data"
                            className="p-2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors disabled:opacity-50 flex-shrink-0">
                            <RefreshCw className={`w-5 h-5 ${loading ? 'motion-safe:animate-spin' : ''}`} aria-hidden />
                        </button>
                    </div>
                </div>
            </div>

            {/* Delete my data confirmation modal */}
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
                            <button onClick={() => setShowDeleteConfirm(false)} disabled={deleting}
                                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50">Cancel</button>
                            <button onClick={deleteMyData} disabled={deleting}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-lg font-medium transition-colors flex items-center gap-2">
                                {deleting ? (
                                    <><RefreshCw className="w-4 h-4 animate-spin" />Deleting...</>
                                ) : (
                                    <><Trash2 className="w-4 h-4" />Delete all my data</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Share link modal */}
            {showSharePopup && (
                <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
                        <div className="flex items-center gap-2 mb-4">
                            <Share2 className="w-5 h-5 text-blue-500 flex-shrink-0" />
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Share Portfolio</h2>
                        </div>
                        <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                            Create a public read-only link to share your portfolio allocation and performance.
                            Your wallet address will be masked.
                        </p>
                        {shareLinkError ? (
                            <p className="text-sm text-red-600 dark:text-red-400 mb-4 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                                {shareLinkError}
                            </p>
                        ) : null}
                        {shareLink ? (
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-900/50 rounded-lg px-3 py-2.5">
                                    <input
                                        type="text"
                                        readOnly
                                        value={`${window.location.origin}/public/${shareLink}`}
                                        className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white outline-none"
                                        onClick={(e) => (e.target as HTMLInputElement).select()}
                                    />
                                    <button
                                        type="button"
                                        onClick={copyShareLinkToClipboard}
                                        className="shrink-0 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 text-xs font-medium transition-colors"
                                    >
                                        Copy
                                    </button>
                                </div>
                                <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                                    <CheckCircle className="w-3 h-3" />
                                    Public link is active
                                </p>
                                <button
                                    type="button"
                                    onClick={revokeShareLink}
                                    disabled={shareLinkLoading}
                                    className="w-full border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                                >
                                    {shareLinkLoading ? 'Revoking...' : 'Revoke public link'}
                                </button>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={createShareLink}
                                disabled={shareLinkLoading}
                                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                            >
                                {shareLinkLoading ? (
                                    <><RefreshCw className="w-4 h-4 animate-spin" />Creating...</>
                                ) : (
                                    <><Share2 className="w-4 h-4" />Generate public link</>
                                )}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setShowSharePopup(false)}
                            className="w-full mt-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}

            {/* Demo reset confirmation modal */}
            {showDemoResetConfirm && (
                <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-3 sm:p-4">
                    <div
                        ref={demoResetDialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="demo-reset-title"
                        aria-describedby="demo-reset-description"
                        aria-busy={resettingDemo}
                        tabIndex={-1}
                        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-4 sm:p-6 min-w-0 max-h-[90vh] overflow-y-auto"
                    >
                        <div className="flex items-center gap-2 mb-4 min-w-0">
                            <AlertCircle className="w-6 h-6 text-amber-500 flex-shrink-0" aria-hidden />
                            <h2 id="demo-reset-title" className="text-xl font-semibold text-gray-900 dark:text-white break-words">Reset Demo Portfolio</h2>
                        </div>
                        <p id="demo-reset-description" className="text-gray-600 dark:text-gray-400 text-sm mb-6 break-words">
                            This will reset the demo portfolio to its default state with $10,000 total value and 40% XLM / 60% USDC allocation. Real wallet balances and on-chain portfolios are not affected.
                        </p>
                        {demoResetError && (
                            <div
                                role="alert"
                                className="mb-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-800 dark:text-red-200"
                            >
                                <p className="font-medium">
                                    {demoResetError.completedSteps.length > 0
                                        ? 'Demo reset stopped halfway while refreshing demo price data.'
                                        : 'Demo reset failed while resetting demo portfolio data.'}
                                </p>
                                <p className="mt-1 text-xs text-red-700 dark:text-red-300">
                                    {demoResetError.completedSteps.length > 0
                                        ? 'Demo portfolio data was already reset and will not be duplicated if you retry. You can retry the remaining step or cancel without reloading the page.'
                                        : 'You can retry resetting or cancel without reloading the page.'}
                                </p>
                                <p className="mt-1 text-xs text-red-600 dark:text-red-400 break-words">
                                    Details: {demoResetError.message}
                                </p>
                            </div>
                        )}
                        <p role="status" className="sr-only">{resettingDemo ? 'Resetting demo portfolio' : ''}</p>
                        {/* aria-disabled (not disabled) while resetting so keyboard focus stays inside the dialog. */}
                        <div className="flex flex-wrap justify-end gap-2 sm:gap-3">
                            <button type="button" onClick={closeDemoResetModal} aria-disabled={resettingDemo}
                                className={`px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm ${resettingDemo ? 'opacity-50 cursor-not-allowed' : ''}`}>Cancel</button>
                            <button ref={demoResetInitialFocusRef} type="button" onClick={resetDemoPortfolio} aria-disabled={resettingDemo}
                                className={`px-4 py-2 text-white rounded-lg font-medium transition-colors flex items-center gap-2 text-sm ${resettingDemo ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}>
                                {resettingDemo ? (
                                    <><RefreshCw className="w-4 h-4 motion-safe:animate-spin flex-shrink-0" aria-hidden />Resetting...</>
                                ) : demoResetError ? (
                                    <><RefreshCw className="w-4 h-4 flex-shrink-0" aria-hidden />{demoResetError.completedSteps.length > 0 ? 'Retry Remaining Steps' : 'Retry Reset'}</>
                                ) : (
                                    <><RefreshCw className="w-4 h-4 flex-shrink-0" aria-hidden />Reset Demo</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Price Ticker Banner */}
            <PriceTicker />

            <div className="p-4 sm:p-6 w-full max-w-7xl mx-auto min-w-0">
                {/* Section navigation. Wraps instead of overflowing at 320px / large text; each
                    control keeps a 44px touch target and exposes the current section. */}
                <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
                    <nav className="flex flex-wrap gap-x-6 gap-y-1" aria-label="Dashboard sections">
                        {([
                            ['overview', 'Overview'],
                            ['analytics', 'Analytics'],
                            ['notifications', 'Notifications'],
                        ] as const).map(([tab, label]) => (
                            <button
                                key={tab}
                                type="button"
                                onClick={() => selectTab(tab, label)}
                                aria-current={activeTab === tab ? 'page' : undefined}
                                // The header also has an "Analytics" link to the full page; qualify the
                                // in-page section so the two controls are never announced identically.
                                aria-label={`${label} section`}
                                className={`min-h-[44px] py-3 px-1 border-b-2 font-medium text-sm ${activeTab === tab
                                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300'
                                }`}
                            >{label}</button>
                        ))}
                    </nav>
                    <p role="status" aria-live="polite" className="sr-only">{navAnnouncement}</p>
                </div>

                {/* Debug Info */}
                {(import.meta as any).env?.DEV && (
                    <div className="bg-gray-100 dark:bg-gray-800 p-2 rounded mb-4 text-xs dark:text-gray-300">
                        <div>Portfolio ID: {portfolioData?.id}</div>
                        <div>Allocations: {JSON.stringify(allocationData)}</div>
                        <div>Price source: {priceSource}</div>
                        {feedMeta ? (
                            <div>Feed: {feedMeta.provider} / {feedMeta.resolutionHint} / degraded={String(feedMeta.degraded)}</div>
                        ) : null}
                    </div>
                )}

                <div role="status">
                    {balancesPending && <p>Loading portfolio balances. Target allocations can be viewed while balances load.</p>}
                    {balancesFailed && <p>Portfolio balances are unavailable. You can still review target allocations.</p>}
                </div>
                {balancesFailed && (
                    <button type="button" aria-disabled={detailsFetching}
                        onClick={async event => {
                            if (detailsFetching) return
                            const retryButton = event.currentTarget
                            const result = await refetchPortfolioDetails()
                            if (result.isSuccess && (document.activeElement === retryButton || document.activeElement === document.body)) {
                                headingRef.current?.focus()
                            }
                        }}
                        className="rounded px-3 py-2 text-blue-700 focus-visible:ring-2 dark:text-blue-300">
                        {detailsFetching ? 'Retrying balances…' : 'Retry loading balances'}
                    </button>
                )}

                {/* Overview Tab */}
                {activeTab === 'overview' && (
                    <div className="grid lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 space-y-6">
                            {/* Portfolio Value Chart */}
                            {balancesUnavailable ? (
                                <div className="rounded-xl bg-white p-6 dark:bg-gray-800">
                                    <h2 className="font-semibold">Portfolio value</h2>
                                    <p>{balancesPending ? 'Loading balances…' : 'Balance data unavailable'}</p>
                                </div>
                            ) : loading ? (
                                <div data-testid="dashboard-value-skeleton" aria-busy="true" className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm animate-pulse">
                                    <div className="flex items-center justify-between mb-6">
                                        <div className="w-32 h-6 bg-gray-300 dark:bg-gray-700 rounded" />
                                        <div className="flex items-center space-x-2">
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
                                <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 shadow-sm min-w-0">
                                    <div className="flex flex-wrap items-center justify-between gap-2 mb-6 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Portfolio Value</h2>
                                            {!publicKey || portfolioData?.id === 'demo' ? (
                                                <span className="px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                                    Demo balance
                                                </span>
                                            ) : (
                                                <span className="px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                                                    Wallet balance
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500 dark:text-gray-400 min-w-0">
                                            <span className="whitespace-nowrap">Last updated: just now</span>
                                            <span className={`px-2 py-1 rounded text-xs ${feedMeta?.degraded || hasPartialPriceData
                                                ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200'
                                                : feedMeta?.staleOrLimited
                                                    ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200'
                                                    : hasLivePriceRows
                                                        ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                                                        : 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400'
                                            }`}>{effectivePriceSource}</span>
                                        </div>
                                    </div>
                                    {showPriceQualityNote && (
                                        <p className="mb-4 text-xs text-amber-800 dark:text-amber-200/90 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
                                            {feedMeta?.degraded
                                                ? 'Displayed prices are synthetic or fallback — not primary market data.'
                                                : hasPartialPriceData
                                                    ? partialPriceMessage
                                                    : 'Price feed may be stale or rate-limited; confirm against an exchange if trading.'}
                                        </p>
                                    )}
                                    <div className="mb-4 min-w-0">
                                        <div className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white flex flex-wrap items-center gap-2 min-w-0 break-words">
                                            <span>${portfolioData?.totalValue?.toLocaleString() || '0'}</span>
                                            {(!publicKey || portfolioData?.id === 'demo') && (
                                                <span className="text-xs font-normal text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded">
                                                    Simulated $10,000
                                                </span>
                                            )}
                                            {liveFeedState === 'connected' && (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400">
                                                    <span className="w-1.5 h-1.5 mr-1.5 bg-red-500 rounded-full animate-pulse"></span>
                                                    LIVE
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap items-center mt-1 text-sm">
                                            <TrendingUp className="w-4 h-4 text-green-500 mr-1 flex-shrink-0" />
                                            <span className="text-green-600 dark:text-green-400 font-medium">+{portfolioData?.dayChange || 0}%</span>
                                            <span className="text-gray-500 dark:text-gray-400 ml-2">Today</span>
                                        </div>
                                    </div>
                                    <div className="h-64">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={performanceData}>
                                                <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#374151' : '#f0f0f0'} />
                                                <XAxis dataKey="date" stroke={isDark ? '#9CA3AF' : '#666'} />
                                                <YAxis stroke={isDark ? '#9CA3AF' : '#666'} />
                                                <Tooltip contentStyle={{
                                                    backgroundColor: isDark ? '#1F2937' : '#fff',
                                                    border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                                                    borderRadius: '8px',
                                                    color: isDark ? '#F9FAFB' : '#111827'
                                                }} />
                                                <Line type="monotone" dataKey="value" stroke="#3B82F6" strokeWidth={3} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            )}

                            {/* Asset Cards — drag to reorder, order persisted per portfolio */}
                            {!balancesUnavailable && <AssetList
                                portfolioId={portfolioData?.id ?? 'demo'}
                                assets={allocationData}
                                prices={Object.fromEntries(
                                    Object.entries(prices).map(([symbol, row]) => [
                                        symbol,
                                        row
                                            ? {
                                                price: typeof row === 'number' ? row : (row as any).price ?? null,
                                                change: typeof row === 'number' ? 0 : (row as any).change ?? null,
                                                source: typeof row === 'object' && row !== null ? (row as any).source : undefined,
                                                quoteAgeSeconds: typeof row === 'object' && row !== null ? (row as any).quoteAgeSeconds : undefined,
                                                servedFromCache: typeof row === 'object' && row !== null ? (row as any).servedFromCache : undefined,
                                                dataTier: typeof row === 'object' && row !== null ? (row as any).dataTier : undefined,
                                            }
                                            : undefined,
                                    ])
                                )}
                                isLoading={loading}
                            />}

                            {/* Rebalance History */}
                            <RebalanceHistory portfolioId={portfolioData?.id || null} isLoading={loading} />
                        </div>

                        <div className="space-y-6">
                            {/* Rebalance Alert */}
                            {portfolioData?.needsRebalance && !balancesUnavailable && (
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
                                    <p className="text-sm text-orange-700 dark:text-orange-400 mb-2">{dashboardCopy.driftMessage}</p>
                                </motion.div>
                            )}

                            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Cost Summary</h3>
                                    <WalletCards className="w-5 h-5 text-blue-500" aria-hidden />
                                </div>
                                {costSummaryLoading ? (
                                    <div className="space-y-3" aria-busy="true">
                                        <div className="h-5 w-28 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                                        <div className="h-5 w-36 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                                        <div className="h-5 w-32 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                                    </div>
                                ) : (
                                    <div className="space-y-3 text-sm">
                                        <div className="flex items-center justify-between">
                                            <span className="text-gray-500 dark:text-gray-400">Total fees paid</span>
                                            <span className="font-semibold text-gray-900 dark:text-white">
                                                {(costSummary?.total_fees_paid ?? 0).toFixed(4)} XLM
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-gray-500 dark:text-gray-400">Avg slippage</span>
                                            <span className="font-semibold text-gray-900 dark:text-white">
                                                {(costSummary?.avg_slippage_bps ?? 0).toFixed(2)} bps
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-gray-500 dark:text-gray-400">Cost per rebalance</span>
                                            <span className="font-semibold text-gray-900 dark:text-white">
                                                {(costSummary?.cost_per_rebalance ?? 0).toFixed(4)} XLM
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-gray-500 dark:text-gray-400">Total rebalances</span>
                                            <span className="font-semibold text-gray-900 dark:text-white">
                                                {costSummary?.total_rebalances ?? 0}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Drift Gauges — live allocation drift per asset */}
                            {!balancesUnavailable && driftGaugeAssets.length > 0 && (
                                <DriftGaugeGrid assets={driftGaugeAssets} title="Live Allocation Drift" />
                            )}

                            {/* Allocation Chart */}
                            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Allocation</h3>
                                {loading ? (
                                    <div data-testid="dashboard-allocation-skeleton" aria-busy="true" className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
                                        <div className="w-32 h-6 bg-gray-300 dark:bg-gray-700 rounded mb-4 animate-pulse" />
                                        <div className="h-48 flex items-center justify-center mb-4">
                                            <div className="w-40 h-40 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className="h-64 flex items-center justify-center">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <PieChart>
                                                    <Pie data={allocationData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                                                        {allocationData.map((entry: any, index: number) => (
                                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                                        ))}
                                                    </Pie>
                                                    <Tooltip />
                                                </PieChart>
                                            </ResponsiveContainer>
                                        </div>
                                        <div className="mt-4 space-y-2">
                                            {allocationData.map((asset: any, index: number) => (
                                                <div key={index} className="flex items-center justify-between">
                                                    <div className="flex items-center">
                                                        <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: asset.color }} />
                                                        <span className="text-sm text-gray-600 dark:text-gray-400">{asset.name}</span>
                                                    </div>
                                                    <span className="text-sm font-medium text-gray-900 dark:text-white">{asset.value}%</span>
                                                </div>
                                            ))}
                                        </div>
                                        {allocationData.length > 0 && (
                                            <>
                                                {(portfolioData as any)?.slippageTolerancePercent != null && (
                                                    <p className="text-xs text-orange-600 dark:text-orange-400 mb-4 break-words min-w-0">
                                                        Max slippage: {(portfolioData as any).slippageTolerancePercent}% — trades beyond this will be rejected
                                                    </p>
                                                )}
                                                <button type="button" onClick={() => setReviewPortfolioId(latestPortfolioId)}
                                                    disabled={balancesUnavailable || !publicKey || !latestPortfolioId}
                                                    className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white py-2 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2">
                                                    Review rebalance
                                                </button>
                                                {(portfolioData as any)?.slippageTolerance != null && (
                                                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-2 text-center break-words min-w-0">
                                                        Max slippage: {(portfolioData as any).slippageTolerance}% — trades above this will be rejected
                                                    </p>
                                                )}
                                                {(!publicKey || portfolioData?.id === 'demo') && (
                                                    <p className="text-xs text-orange-600 dark:text-orange-400 mt-2 text-center">
                                                        {!publicKey ? 'Connect wallet to execute rebalance' : 'Create a real portfolio to enable rebalancing'}
                                                    </p>
                                                )}
                                            </>
                                        )}
                                    </>
                                )}
                            </div>

                            <PriceTracker />
                        </div>
                    </div>
                )}

                {/* Analytics Tab */}
                {activeTab === 'analytics' && (
                    <div className="space-y-6">
                        {/* Asset selector for candlestick chart */}
                        {allocationData.length > 0 && (
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm text-gray-500 dark:text-gray-400">Price chart:</span>
                                {allocationData.map((asset: any) => (
                                    <button
                                        key={asset.name}
                                        type="button"
                                        onClick={() => setCandlestickAsset(asset.name)}
                                        aria-pressed={candlestickAsset === asset.name}
                                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                                            candlestickAsset === asset.name
                                                ? 'bg-blue-600 text-white'
                                                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                                        }`}
                                    >
                                        {asset.name}
                                    </button>
                                ))}
                            </div>
                        )}
                        <PriceCandlestick
                            asset={candlestickAsset}
                            portfolioCreatedAt={(portfolioData as any)?.createdAt ?? null}
                            portfolioId={portfolioData?.id ?? null}
                            onRebalanceClick={(_ev: CandlestickRebalanceEvent) => {}}
                        />
                        <PerformanceChart portfolioId={portfolioData?.id || null} />
                        <AllocationHistory portfolioId={portfolioData?.id || null} />
                    </div>
                )}

                {/* Notifications Tab */}
                {activeTab === 'notifications' && publicKey && (
                    <div className="space-y-6">
                        <NotificationPreferences userId={publicKey} />
                    </div>
                )}
                {activeTab === 'notifications' && !publicKey && (
                    <p className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 text-sm text-gray-600 dark:text-gray-300">
                        Connect a wallet to manage notification preferences.
                    </p>
                )}
            </div>

            {/* Sticky and in-flow so enlarged text cannot cover dashboard content. */}
            <div role="region" aria-label="Portfolio quick actions" className="mobile-action-bar sticky bottom-0 mt-auto bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-3 py-2 sm:p-4 md:hidden z-40">
                <div className="flex flex-wrap items-center justify-between gap-2 max-w-sm mx-auto min-w-0">
                    <div className="text-left min-w-0">
                        <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                            <span>Total Value</span>
                            {(!publicKey || portfolioData?.id === 'demo') && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold uppercase bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                    Demo
                                </span>
                            )}
                        </div>
                        <div id="mobile-total-value" className="text-base sm:text-lg font-bold text-gray-900 dark:text-white break-words">
                            {balancesUnavailable ? 'Balance unavailable' : `$${portfolioData?.totalValue?.toLocaleString() ?? '0'}`}
                        </div>
                        <div className={`text-xs flex items-center gap-1 ${(portfolioData?.dayChange || 0) >= 0
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}>
                            {(portfolioData?.dayChange || 0) >= 0 ? <TrendingUp className="w-3 h-3 flex-shrink-0" aria-hidden /> : <TrendingUp className="w-3 h-3 rotate-180 flex-shrink-0" aria-hidden />}
                            <span className="sr-only">{(portfolioData?.dayChange || 0) >= 0 ? 'Up' : 'Down'} today:</span>
                            <span>{Math.abs(portfolioData?.dayChange || 0.85).toFixed(2)}%</span>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        {latestPortfolioId ? (
                            <button type="button" onClick={() => setReviewPortfolioId(latestPortfolioId)}
                                aria-label="Review rebalance on mobile"
                                disabled={balancesUnavailable}
                                aria-describedby={balancesUnavailable ? 'mobile-total-value' : undefined}
                                className="bg-orange-600 hover:bg-orange-700 disabled:bg-orange-400 text-white px-3 sm:px-4 py-2 min-h-[44px] rounded-lg text-sm font-medium transition-colors flex items-center gap-1">
                                Review rebalance
                            </button>
                        ) : (
                            <div className="flex items-center gap-1 text-green-600 dark:text-green-400 text-sm">
                                <CheckCircle className="w-4 h-4 flex-shrink-0" aria-hidden />
                                <span className="sr-only sm:not-sr-only">Balanced</span>
                            </div>
                        )}

                        {publicKey ? (
                            <button type="button" onClick={() => onNavigate('setup')}
                                aria-label="New portfolio"
                                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 min-h-[44px] min-w-[44px] justify-center rounded-lg text-sm transition-colors flex items-center gap-1">
                                <Plus className="w-4 h-4 flex-shrink-0" aria-hidden />
                                <span className="hidden sm:inline" aria-hidden>New</span>
                            </button>
                        ) : (
                            <button type="button" onClick={() => setShowDemoResetConfirm(true)}
                                aria-label="Reset demo data"
                                aria-haspopup="dialog"
                                className="border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-2.5 sm:px-3 py-2 min-h-[44px] rounded-lg text-sm transition-colors flex items-center gap-1">
                                <RefreshCw className="w-4 h-4 flex-shrink-0" aria-hidden />
                                <span aria-hidden>Reset</span>
                            </button>
                        )}

                        <button ref={mobileRefreshRef} type="button" onClick={handleRefreshClick} disabled={loading}
                            aria-label="Refresh portfolio data"
                            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors disabled:opacity-50 flex-shrink-0">
                            <RefreshCw className={`w-5 h-5 ${loading ? 'motion-safe:animate-spin' : ''}`} aria-hidden />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default Dashboard
