import { TrendingUp, TrendingDown, Wifi, WifiOff } from 'lucide-react'

// TanStack Query Hooks
import { usePrices } from '../hooks/queries/usePricesQuery'
import React, { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, Wifi, WifiOff } from 'lucide-react'
import { api, API_CONFIG, ENDPOINTS } from '../config/api'

interface PriceTrackerProps {
    compact?: boolean
}

interface PriceData {
    price: number
    change: number
    source: string
    timestamp: number
    volume?: number
}

const PriceTracker: React.FC<PriceTrackerProps> = ({ compact = false }) => {
    // Query for prices
    const { data: priceData, isLoading, error: queryError } = usePrices()

    const retryConnection = () => {
        // TanStack Query handles retries, but we can refetch manually
        window.location.reload()
    }

    // Determine finalized data and loading state
    const prices: Record<string, PriceData> = priceData || {}
    const loading = isLoading && Object.keys(prices).length === 0
    const error = queryError ? 'Failed to fetch real-time prices' : null
    const isConnected = !queryError
    const lastUpdate = new Date().toLocaleTimeString()

    // NEW: Show skeleton loading state
    if (loading && Object.keys(prices).length === 0) {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4 animate-pulse">
                    <div className="w-32 h-6 bg-gray-300 dark:bg-gray-700 rounded" />
                    <div className="w-24 h-4 bg-gray-300 dark:bg-gray-700 rounded" />
                </div>
                {/* Skeleton grid for price cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg animate-pulse">
                            <div className="flex items-center justify-between mb-2">
                                <div className="w-16 h-4 bg-gray-300 dark:bg-gray-600 rounded" />
                                <div className="w-12 h-5 bg-gray-300 dark:bg-gray-600 rounded" />
                            </div>
                            <div className="w-24 h-6 bg-gray-300 dark:bg-gray-600 rounded mb-2" />
                            <div className="w-16 h-4 bg-gray-300 dark:bg-gray-600 rounded" />
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    const assets = ['XLM', 'BTC', 'ETH', 'USDC']

    if (compact) {
        return (
            <div className="flex items-center space-x-4 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="flex items-center space-x-1">
                    {isConnected ?
                        <Wifi className="w-4 h-4 text-green-500" /> :
                        <WifiOff className="w-4 h-4 text-red-500" />
                    }
                </div>
                {assets.map(asset => {
                    const data = prices[asset]
                    if (!data) return null

                    return (
                        <div key={asset} className="flex items-center space-x-1">
                            <span className="text-sm font-medium">{asset}</span>
                            <span className="text-sm">
                                ${data.price < 1 ? data.price.toFixed(6) : data.price.toLocaleString()}
                            </span>
                            <span className={`text-xs flex items-center ${data.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {data.change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                                {Math.abs(data.change).toFixed(2)}%
                            </span>
                        </div>
                    )
                })}
                <div className="text-xs text-gray-500 dark:text-gray-400">
                    {lastUpdate}
                </div>
            </div>
        )
    }

    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Real-time Prices</h3>
                <div className="flex items-center space-x-2">
                    <div className="flex items-center space-x-1">
                        {isConnected ?
                            <Wifi className="w-4 h-4 text-green-500" /> :
                            <WifiOff className="w-4 h-4 text-red-500" />
                        }
                        <span className={`text-xs ${isConnected ? 'text-green-600' : 'text-red-600'}`}>
                            {isConnected ? 'Connected' : 'Disconnected'}
                        </span>
                    </div>
                    {error && (
                        <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/30 px-2 py-1 rounded cursor-pointer"
                            onClick={retryConnection}>
                            {error} (Click to retry)
                        </div>
                    )}
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                        Last update: {lastUpdate}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {assets.map(asset => {
                    const data = prices[asset]
                    if (!data) return (
                        <div key={asset} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                            <div className="text-sm text-gray-500 dark:text-gray-400">Loading {asset}...</div>
                        </div>
                    )

                    return (
                        <div key={asset} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                            <div className="flex items-center justify-between mb-2">
                                <span className="font-medium text-gray-900 dark:text-white">{asset}</span>
                                <div className={`px-2 py-1 rounded text-xs ${data.source === 'coingecko_pro' ? 'bg-green-100 text-green-800' :
                                    data.source === 'coingecko_free' || data.source === 'coingecko' ? 'bg-blue-100 text-blue-800' :
                                        data.source === 'reflector' ? 'bg-purple-100 text-purple-800' :
                                            'bg-red-100 text-red-800'
                                    }`}>
                                    {data.source === 'coingecko_pro' ? 'Pro' :
                                        data.source === 'coingecko_free' || data.source === 'coingecko' ? 'CoinGecko' :
                                            data.source === 'reflector' ? 'Reflector' :
                                                'Fallback'}
                                </div>
                            </div>

                            <div className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
                                ${data.price < 1 ? data.price.toFixed(6) : data.price.toLocaleString()}
                            </div>

                            <div className={`flex items-center ${data.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {data.change >= 0 ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
                                <span className="font-medium">
                                    {data.change >= 0 ? '+' : ''}{data.change.toFixed(2)}%
                                </span>
                            </div>

                            {data.volume && (
                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    Vol: ${data.volume.toLocaleString()}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            {!isConnected && (
                <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center">
                            <WifiOff className="w-4 h-4 text-yellow-600 dark:text-yellow-400 mr-2" />
                            <span className="text-sm text-yellow-800 dark:text-yellow-300">
                                Connection lost. Showing last known prices.
                            </span>
                        </div>
                        <button
                            onClick={retryConnection}
                            className="text-sm bg-yellow-200 hover:bg-yellow-300 dark:bg-yellow-800 dark:hover:bg-yellow-700 text-yellow-800 dark:text-yellow-200 px-3 py-1 rounded transition-colors"
                        >
                            Retry
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

export default PriceTracker
