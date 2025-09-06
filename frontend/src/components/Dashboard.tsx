import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, AlertCircle, RefreshCw, ArrowLeft, ExternalLink } from 'lucide-react'
import AssetCard from './AssetCard'
import RebalanceHistory from './RebalanceHistory'
import { StellarWallet } from '../utils/stellar'
import PriceTracker from './PriceTracker'
import { API_CONFIG } from '../config/api'

interface DashboardProps {
    onNavigate: (view: string) => void
    publicKey: string | null
}

const Dashboard: React.FC<DashboardProps> = ({ onNavigate, publicKey }) => {
    const [portfolioData, setPortfolioData] = useState<any>(null)
    const [prices, setPrices] = useState<any>({})
    const [loading, setLoading] = useState(true)
    const [rebalancing, setRebalancing] = useState(false)

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
            const response = await fetch(`${API_CONFIG.BASE_URL}/api/prices`)
            if (response.ok) {
                const priceData = await response.json()
                console.log('Fetched prices:', priceData)
                setPrices(priceData)
            }
        } catch (error) {
            console.error('Failed to fetch prices:', error)
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
        setPrices({
            XLM: { price: 0.354, change: -1.86 },
            USDC: { price: 1.0, change: -0.01 },
            BTC: { price: 110000, change: -1.19 },
            ETH: { price: 4200, change: -1.50 }
        })
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
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500 mx-auto"></div>
                    <p className="mt-4 text-gray-600">Loading portfolio data...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center">
                        <button
                            onClick={() => onNavigate('landing')}
                            className="mr-4 p-2 text-gray-500 hover:text-gray-700 transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">Portfolio Dashboard</h1>
                            {publicKey ? (
                                <div className="flex items-center space-x-4 mt-1">
                                    <div className="flex items-center space-x-2 text-sm text-gray-600">
                                        <span className="capitalize font-medium">
                                            {walletType} Wallet
                                        </span>
                                        <span>{publicKey.slice(0, 4)}...{publicKey.slice(-4)}</span>
                                    </div>
                                    <div className="flex items-center space-x-1 text-xs text-gray-500">
                                        <span>Contract:</span>
                                        <code className="bg-gray-100 px-1 rounded">{contractAddress.slice(0, 4)}...{contractAddress.slice(-4)}</code>
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
                                <span className="text-sm bg-yellow-100 text-yellow-800 px-2 py-1 rounded mt-1 inline-block">
                                    Demo Mode - Connect wallet for full functionality
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center space-x-4">
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
                {/* Debug Info */}
                {process.env.NODE_ENV === 'development' && (
                    <div className="bg-gray-100 p-2 rounded mb-4 text-xs">
                        <div>Portfolio ID: {portfolioData?.id}</div>
                        <div>Allocations: {JSON.stringify(allocationData)}</div>
                    </div>
                )}

                {/* Portfolio Overview */}
                <div className="grid lg:grid-cols-3 gap-6 mb-8">
                    <div className="lg:col-span-2">
                        <div className="bg-white rounded-xl p-6 shadow-sm">
                            <div className="flex items-center justify-between mb-6">
                                <h2 className="text-lg font-semibold text-gray-900">Portfolio Value</h2>
                                <div className="flex items-center space-x-2 text-sm text-gray-500">
                                    <span>Last updated: just now</span>
                                    {prices.XLM && (
                                        <span className="text-green-600">Live prices</span>
                                    )}
                                </div>
                            </div>
                            <div className="mb-4">
                                <div className="text-3xl font-bold text-gray-900">
                                    ${portfolioData?.totalValue?.toLocaleString() || '0'}
                                </div>
                                <div className="flex items-center mt-1">
                                    <TrendingUp className="w-4 h-4 text-green-500 mr-1" />
                                    <span className="text-green-500 font-medium">+{portfolioData?.dayChange || 0}%</span>
                                    <span className="text-gray-500 ml-2">Today</span>
                                </div>
                            </div>
                            <div className="h-64">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={performanceData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                        <XAxis dataKey="date" stroke="#666" />
                                        <YAxis stroke="#666" />
                                        <Tooltip
                                            contentStyle={{
                                                backgroundColor: '#fff',
                                                border: '1px solid #e5e7eb',
                                                borderRadius: '8px'
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
                        <div className="bg-white rounded-xl p-6 shadow-sm">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4">Current Allocation</h3>
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
                                            <span className="text-sm font-medium">{asset.name}</span>
                                        </div>
                                        <span className="text-sm text-gray-600">{asset.value}%</span>
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
                <RebalanceHistory />
            </div>
        </div>
    )
}

export default Dashboard