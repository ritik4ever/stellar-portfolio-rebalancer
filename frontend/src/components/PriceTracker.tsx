import React, { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, Activity, Wifi, WifiOff } from 'lucide-react'
import { API_CONFIG } from '../config/api'

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
    const [prices, setPrices] = useState<Record<string, PriceData>>({})
    const [loading, setLoading] = useState(true)
    const [lastUpdate, setLastUpdate] = useState<string>('')
    const [error, setError] = useState<string | null>(null)
    const [isConnected, setIsConnected] = useState(true)

    useEffect(() => {
        console.log('PriceTracker mounted, API_CONFIG:', API_CONFIG)
        fetchPrices()

        // Update every 60 seconds instead of 30 to avoid rate limits
        const interval = setInterval(fetchPrices, 60000)
        return () => clearInterval(interval)
    }, [])

    const fetchPrices = async () => {
        try {
            const url = `${API_CONFIG.BASE_URL}/api/prices`
            console.log('Fetching prices from:', url)

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                // Add timeout to prevent hanging requests
                signal: AbortSignal.timeout(10000)
            })

            console.log('Response status:', response.status)
            console.log('Response headers:', Object.fromEntries(response.headers.entries()))

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`)
            }

            const rawData = await response.text()
            console.log('Raw response:', rawData)

            // Parse JSON safely
            let data
            try {
                data = JSON.parse(rawData)
            } catch (parseError) {
                console.error('JSON parse error:', parseError)
                throw new Error('Invalid JSON response from server')
            }

            console.log('Parsed price data:', data)

            // Transform the data to match expected format
            const transformedPrices: Record<string, PriceData> = {}

            // Handle different possible response formats
            if (data && typeof data === 'object') {
                Object.keys(data).forEach(asset => {
                    const assetData = data[asset]

                    // Handle both direct price objects and nested structures
                    if (assetData && typeof assetData === 'object') {
                        transformedPrices[asset] = {
                            price: assetData.price || assetData.usd || 0,
                            change: assetData.change || assetData.usd_24h_change || 0,
                            source: assetData.source || 'coingecko',
                            timestamp: assetData.timestamp || Date.now() / 1000,
                            volume: assetData.volume || assetData.usd_24h_vol || 0
                        }
                    } else if (typeof assetData === 'number') {
                        // Handle simple price format
                        transformedPrices[asset] = {
                            price: assetData,
                            change: 0,
                            source: 'unknown',
                            timestamp: Date.now() / 1000,
                            volume: 0
                        }
                    }
                })
            }

            console.log('Transformed prices:', transformedPrices)

            // Only update if we have valid data
            if (Object.keys(transformedPrices).length > 0) {
                setPrices(transformedPrices)
                setError(null)
                setIsConnected(true)
            } else {
                throw new Error('No valid price data received')
            }

            setLastUpdate(new Date().toLocaleTimeString())
            setLoading(false)

        } catch (error) {
            console.error('Failed to fetch prices:', error)
            setError(error instanceof Error ? error.message : 'Failed to fetch real-time prices')
            setIsConnected(false)

            // Only use fallback if we have no data at all
            if (Object.keys(prices).length === 0) {
                console.log('Using fallback prices')
                setPrices({
                    XLM: {
                        price: 0.355735,
                        change: -1.09,
                        source: 'fallback',
                        timestamp: Date.now() / 1000
                    },
                    BTC: {
                        price: 110209,
                        change: -0.31,
                        source: 'fallback',
                        timestamp: Date.now() / 1000
                    },
                    ETH: {
                        price: 4285.36,
                        change: -0.31,
                        source: 'fallback',
                        timestamp: Date.now() / 1000
                    },
                    USDC: {
                        price: 0.999835,
                        change: 0.00,
                        source: 'fallback',
                        timestamp: Date.now() / 1000
                    }
                })
            }
            setLastUpdate(new Date().toLocaleTimeString())
            setLoading(false)
        }
    }

    const retryConnection = () => {
        setLoading(true)
        setError(null)
        fetchPrices()
    }

    if (loading && Object.keys(prices).length === 0) {
        return (
            <div className="flex items-center justify-center p-4">
                <Activity className="w-5 h-5 animate-spin text-blue-500" />
                <span className="ml-2 text-gray-600">Loading real-time prices...</span>
            </div>
        )
    }

    const assets = ['XLM', 'BTC', 'ETH', 'USDC']

    if (compact) {
        return (
            <div className="flex items-center space-x-4 p-2 bg-gray-50 rounded-lg">
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
                <div className="text-xs text-gray-500">
                    {lastUpdate}
                </div>
            </div>
        )
    }

    return (
        <div className="bg-white rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Real-time Prices</h3>
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
                        <div className="text-xs text-red-500 bg-red-50 px-2 py-1 rounded cursor-pointer"
                            onClick={retryConnection}>
                            {error} (Click to retry)
                        </div>
                    )}
                    <div className="text-sm text-gray-500">
                        Last update: {lastUpdate}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {assets.map(asset => {
                    const data = prices[asset]
                    if (!data) return (
                        <div key={asset} className="p-4 bg-gray-50 rounded-lg">
                            <div className="text-sm text-gray-500">Loading {asset}...</div>
                        </div>
                    )

                    return (
                        <div key={asset} className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                            <div className="flex items-center justify-between mb-2">
                                <span className="font-medium text-gray-900">{asset}</span>
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

                            <div className="text-2xl font-bold text-gray-900 mb-1">
                                ${data.price < 1 ? data.price.toFixed(6) : data.price.toLocaleString()}
                            </div>

                            <div className={`flex items-center ${data.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {data.change >= 0 ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
                                <span className="font-medium">
                                    {data.change >= 0 ? '+' : ''}{data.change.toFixed(2)}%
                                </span>
                            </div>

                            {data.volume && (
                                <div className="text-xs text-gray-500 mt-1">
                                    Vol: ${data.volume.toLocaleString()}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            {!isConnected && (
                <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center">
                            <WifiOff className="w-4 h-4 text-yellow-600 mr-2" />
                            <span className="text-sm text-yellow-800">
                                Connection lost. Showing last known prices.
                            </span>
                        </div>
                        <button
                            onClick={retryConnection}
                            className="text-sm bg-yellow-200 hover:bg-yellow-300 text-yellow-800 px-3 py-1 rounded transition-colors"
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
