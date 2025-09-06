import React, { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, Activity } from 'lucide-react'
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

    useEffect(() => {
        fetchPrices()
        const interval = setInterval(fetchPrices, 60000) // Update every 60 seconds to avoid rate limits
        return () => clearInterval(interval)
    }, [])

    const fetchPrices = async () => {
        try {
            console.log('Fetching prices from:', `${API_CONFIG.BASE_URL}/api/prices`)
            const response = await fetch(`${API_CONFIG.BASE_URL}/api/prices`)

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`)
            }

            const data = await response.json()
            console.log('Raw price data:', data)

            // Transform the data to match expected format
            const transformedPrices: Record<string, PriceData> = {}

            // Handle the response format from your backend
            Object.keys(data).forEach(asset => {
                if (data[asset] && typeof data[asset] === 'object') {
                    transformedPrices[asset] = {
                        price: data[asset].price || 0,
                        change: data[asset].change || 0,
                        source: data[asset].source || 'unknown',
                        timestamp: data[asset].timestamp || Date.now() / 1000,
                        volume: data[asset].volume || 0
                    }
                }
            })

            console.log('Transformed prices:', transformedPrices)
            setPrices(transformedPrices)
            setLastUpdate(new Date().toLocaleTimeString())
            setLoading(false)
            setError(null)
        } catch (error) {
            console.error('Failed to fetch prices:', error)
            setError('Failed to fetch real-time prices')

            // Only use fallback if we have no data at all
            if (Object.keys(prices).length === 0) {
                setPrices({
                    XLM: { price: 0.354, change: -1.86, source: 'fallback', timestamp: Date.now() / 1000 },
                    BTC: { price: 110000, change: -1.19, source: 'fallback', timestamp: Date.now() / 1000 },
                    ETH: { price: 4200, change: -1.50, source: 'fallback', timestamp: Date.now() / 1000 },
                    USDC: { price: 1.0, change: -0.01, source: 'fallback', timestamp: Date.now() / 1000 }
                })
            }
            setLastUpdate(new Date().toLocaleTimeString())
            setLoading(false)
        }
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
                {assets.map(asset => {
                    const data = prices[asset]
                    if (!data) return null

                    return (
                        <div key={asset} className="flex items-center space-x-1">
                            <span className="text-sm font-medium">{asset}</span>
                            <span className="text-sm">${data.price.toFixed(data.price < 1 ? 4 : 2)}</span>
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
                    {error && (
                        <div className="text-xs text-red-500 bg-red-50 px-2 py-1 rounded">
                            {error}
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
                        <div key={asset} className="p-4 bg-gray-50 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                                <span className="font-medium text-gray-900">{asset}</span>
                                <div className={`px-2 py-1 rounded text-xs ${data.source === 'coingecko_pro' ? 'bg-green-100 text-green-800' :
                                    data.source === 'coingecko_free' ? 'bg-blue-100 text-blue-800' :
                                        data.source === 'reflector' ? 'bg-purple-100 text-purple-800' :
                                            'bg-red-100 text-red-800'
                                    }`}>
                                    {data.source === 'coingecko_pro' ? 'Pro' :
                                        data.source === 'coingecko_free' ? 'CoinGecko' :
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
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

export default PriceTracker