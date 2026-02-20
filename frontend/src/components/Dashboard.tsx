import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, AlertCircle, RefreshCw, ArrowLeft, ExternalLink } from 'lucide-react'
import ThemeToggle from './ThemeToggle'
import { useTheme } from '../context/ThemeContext'
import AssetCard from './AssetCard'
import RebalanceHistory from './RebalanceHistory'
import PerformanceChart from './PerformanceChart'
import NotificationPreferences from './NotificationPreferences'
import { NotificationTest } from './NotificationTest'
import { StellarWallet } from '../utils/stellar'
import PriceTracker from './PriceTracker'
import { API_CONFIG } from '../config/api'
import { browserPriceService } from '../services/browserPriceService'

//  NEW: export utils (create frontend/src/utils/export.ts first)
import { downloadCSV, downloadJSON, toCSV } from '../utils/export'

interface DashboardProps {
    onNavigate: (view: string) => void
    publicKey: string | null
}

const Dashboard: React.FC<DashboardProps> = ({ onNavigate, publicKey }) => {
    const [portfolioData, setPortfolioData] = useState<any>(null)
    const [prices, setPrices] = useState<any>({})
    const [loading, setLoading] = useState(true)
    const [rebalancing, setRebalancing] = useState(false)
    const [priceSource, setPriceSource] = useState<string>('loading...')
    const [activeTab, setActiveTab] = useState<'overview' | 'analytics' | 'notifications' | 'test-notifications'>('overview')
    const { isDark } = useTheme()

    useEffect(() => {
        if (publicKey) {
            fetchPortfolioData()
            fetchPrices()
            const interval = setInterval(() => {
                fetchPrices()
            }, 60000) // Reduce frequency to avoid rate limits
            return () => clearInterval(interval)
        } else {
            loadDemoData()
        }
    }, [publicKey])

    const fetchPortfolioData = async () => {
        try {
            console.log('Fetching portfolio data for:', publicKey)
            const response = await fetch(`${API_CONFIG.BASE_URL}/api/user/${publicKey}/portfolios`)

            if (response.ok) {
                const portfolios = await response.json()
                console.log('Found portfolios:', portfolios)

                if (portfolios.length > 0) {
                    // Use the most recent portfolio (last in array)
                    const latestPortfolio = portfolios[portfolios.length - 1]
                    console.log('Using portfolio:', latestPortfolio)

                    const portfolioResponse = await fetch(`${API_CONFIG.BASE_URL}/api/portfolio/${latestPortfolio.id}`)
                    if (portfolioResponse.ok) {
                        const data = await portfolioResponse.json()
                        console.log('Portfolio data:', data)
                        setPortfolioData(data.portfolio || data)
                    } else {
                        console.log('Portfolio details fetch failed, using list data')
                        setPortfolioData(latestPortfolio)
                    }
                } else {
                    console.log('No portfolios found, loading demo data')
                    loadDemoData()
                }
            } else {
                console.log('Portfolio list fetch failed, loading demo data')
                loadDemoData()
            }
        } catch (error) {
            console.error('Failed to fetch portfolio:', error)
            loadDemoData()
        } finally {
            setLoading(false)
        }
    }

    const fetchPrices = async () => {
        try {
            console.log('Fetching prices using browser service...')
            // Use browser price service directly
            const priceData = await browserPriceService.getCurrentPrices()
            console.log('Browser prices fetched:', priceData)

            // Transform to expected format if needed
            const transformedPrices: any = {}
            Object.entries(priceData).forEach(([asset, data]) => {
                transformedPrices[asset] = {
                    price: (data as any).price,
                    change: (data as any).change || 0
                }
            })

            setPrices(transformedPrices)
            setPriceSource('CoinGecko Browser API')
        } catch (error) {
            console.error('Failed to fetch prices from browser service:', error)
            setPriceSource('Fallback Data')

            // Fallback to demo prices
            setPrices({
                XLM: { price: 0.354, change: -1.86 },
                USDC: { price: 1.0, change: -0.01 },
                BTC: { price: 110000, change: -1.19 },
                ETH: { price: 4200, change: -1.50 }
            })
        }
    }

    const loadDemoData = () => {
        console.log('Loading demo data')
        setPortfolioData({
            id: 'demo',
            totalValue: 10000,
            dayChange: 0.85,
            needsRebalance: false,
            lastRebalance: '2 hours ago',
            allocations: [
                { asset: 'XLM', target: 40, current: 40.2, amount: 4020 },
                { asset: 'USDC', target: 60, current: 59.8, amount: 5980 }
            ]
        })

        // Load demo prices and try to get real prices
        fetchPrices()
        setLoading(false)
    }

    const executeRebalance = async () => {
        if (!portfolioData?.id || portfolioData.id === 'demo') {
            alert('Rebalancing not available in demo mode. Please create a real portfolio.')
            return
        }

        setRebalancing(true)

        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/api/portfolio/${portfolioData.id}/rebalance`, {
                method: 'POST'
            })

            if (response.ok) {
                const result = await response.json()
                alert(`Rebalance executed successfully! Gas used: ${result.result?.gasUsed || 'N/A'}`)
                fetchPortfolioData() // Refresh data
            } else {
                alert('Rebalance failed. Please try again.')
            }
        } catch (error) {
            console.error('Rebalance failed:', error)
            alert('Rebalance failed. Please try again.')
        } finally {
            setRebalancing(false)
        }
    }

    const refreshData = async () => {
        setLoading(true)
        await Promise.all([fetchPortfolioData(), fetchPrices()])
        setLoading(false)
    }

    const disconnectWallet = () => {
        StellarWallet.disconnect()
        onNavigate('landing')
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

    // NEW: Export helpers (Portfolio CSV / JSON) - works in demo mode too
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

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500 mx-auto"></div>
                    <p className="mt-4 text-gray-600 dark:text-gray-400">Loading portfolio data...</p>
                </div>
            </div>
        )
    }

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

                    <div className="flex items-center space-x-4">
                        <ThemeToggle />
                        {/*  NEW: Export buttons */}
                        <div className="flex items-center space-x-2">
                            <button
                                onClick={exportPortfolioCSV}
                                disabled={!portfolioData}
                                className="border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
                            >
                                Export CSV
                            </button>
                            <button
                                onClick={exportPortfolioJSON}
                                disabled={!portfolioData}
                                className="border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
                            >
                                Export JSON
                            </button>
                        </div>

                        {publicKey ? (
                            <>
                                <button
                                    onClick={() => onNavigate('setup')}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
                                >
                                    Create Portfolio
                                </button>
                                <button
                                    onClick={disconnectWallet}
                                    className="text-red-600 hover:text-red-700 px-3 py-2 text-sm transition-colors"
                                >
                                    Disconnect
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={() => onNavigate('landing')}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
                            >
                                Connect Wallet
                            </button>
                        )}
                        <button
                            onClick={refreshData}
                            disabled={loading}
                            className="p-2 text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50"
                        >
                            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>
            </div>

            <div className="p-6 max-w-7xl mx-auto">
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
                        </button>
                        <button
                            onClick={() => setActiveTab('analytics')}
                            className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'analytics'
                                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300'
                                }`}
                        >
                            Analytics
                        </button>
                        <button
                            onClick={() => setActiveTab('notifications')}
                            className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'notifications'
                                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300'
                                }`}
                        >
                            Notifications
                        </button>
                       
                    </nav>
                </div>

                {/* Debug Info */}
                {(import.meta as any).env?.DEV && (
                    <div className="bg-gray-100 dark:bg-gray-800 p-2 rounded mb-4 text-xs dark:text-gray-300">
                        <div>Portfolio ID: {portfolioData?.id}</div>
                        <div>Allocations: {JSON.stringify(allocationData)}</div>
                        <div>Price Source: {priceSource}</div>
                    </div>
                )}

                {activeTab === 'analytics' ? (
                    <PerformanceChart portfolioId={portfolioData?.id || null} />
                ) : activeTab === 'notifications' ? (
                    <NotificationPreferences userId={publicKey || 'demo'} />
                ) :  (
                    <>
                        {/* Portfolio Overview */}
                        <div className="grid lg:grid-cols-3 gap-6 mb-8">
                            <div className="lg:col-span-2">
                                <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
                                    <div className="flex items-center justify-between mb-6">
                                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Portfolio Value</h2>
                                        <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
                                            <span>Last updated: just now</span>
                                            <span
                                                className={`px-2 py-1 rounded text-xs ${priceSource.includes('Browser')
                                                    ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                                                    : 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400'
                                                    }`}
                                            >
                                                {priceSource}
                                            </span>
                                        </div>
                                    </div>
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
                            </div>

                            <div className="space-y-6">
                                {/* Rebalance Alert */}
                                {portfolioData?.needsRebalance && (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        className="bg-gradient-to-r from-orange-50 to-red-50 border border-orange-200 rounded-xl p-6"
                                    >
                                        <div className="flex items-center mb-3">
                                            <AlertCircle className="w-5 h-5 text-orange-500 mr-2" />
                                            <span className="font-medium text-orange-800">Rebalance Needed</span>
                                        </div>
                                        <p className="text-sm text-orange-700 mb-4">
                                            Your portfolio has drifted from target allocation
                                        </p>
                                        <button
                                            onClick={executeRebalance}
                                            disabled={rebalancing || !publicKey || portfolioData?.id === 'demo'}
                                            className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white py-2 px-4 rounded-lg font-medium transition-colors flex items-center justify-center"
                                        >
                                            {rebalancing ? (
                                                <>
                                                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                                    Rebalancing...
                                                </>
                                            ) : (
                                                'Execute Rebalance'
                                            )}
                                        </button>
                                        {(!publicKey || portfolioData?.id === 'demo') && (
                                            <p className="text-xs text-orange-600 mt-2 text-center">
                                                {!publicKey ? 'Connect wallet to execute rebalance' : 'Create a real portfolio to enable rebalancing'}
                                            </p>
                                        )}
                                    </motion.div>
                                )}

                                {/* Allocation Chart */}
                                <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
                                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Current Allocation</h3>
                                    <div className="h-48 flex items-center justify-center">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie
                                                    data={allocationData}
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={60}
                                                    outerRadius={90}
                                                    dataKey="value"
                                                >
                                                    {allocationData.map((entry: any, index: number) => (
                                                        <Cell key={index} fill={entry.color} />
                                                    ))}
                                                </Pie>
                                                <Tooltip />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>
                                    <div className="space-y-2 mt-4">
                                        {allocationData.map((asset: any, index: number) => (
                                            <div key={index} className="flex items-center justify-between">
                                                <div className="flex items-center">
                                                    <div className={`w-3 h-3 rounded-full mr-2`} style={{ backgroundColor: asset.color }} />
                                                    <span className="text-sm font-medium dark:text-gray-200">{asset.name}</span>
                                                </div>
                                                <span className="text-sm text-gray-600 dark:text-gray-400">{asset.value}%</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Price Tracker */}
                        <div className="mb-8">
                            <PriceTracker />
                        </div>

                        {/* Asset Cards */}
                        <div className="grid lg:grid-cols-3 gap-6 mb-8">
                            {allocationData.map((asset: any, index: number) => (
                                <AssetCard key={index} asset={asset} price={prices[asset.name]} />
                            ))}
                        </div>

                        {/* Rebalance History */}
                        <RebalanceHistory portfolioId={portfolioData?.id || undefined} />
                    </>
                )}
            </div>
        </div>
    )
}

export default Dashboard