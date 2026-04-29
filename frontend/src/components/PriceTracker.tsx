import React, { useMemo } from 'react'
import { Wifi, WifiOff, TrendingUp, TrendingDown } from 'lucide-react'
import { usePrices, type PriceFeedClientMeta } from '../hooks/queries/usePricesQuery'
import { useAssets } from '../hooks/queries/useAssetsQuery'
import { useRealtimeConnection } from '../context/RealtimeConnectionContext'

interface PriceTrackerProps {
    compact?: boolean
}

interface PriceData {
    price: number
    change: number
    source: string
    timestamp: number
    volume?: number
    servedFromCache?: boolean
    quoteAgeSeconds?: number
    dataTier?: string
}

function sourceBadgeClass(source: string): string {
    if (source === 'coingecko_pro') return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
    if (source === 'coingecko_free' || source === 'coingecko' || source === 'coingecko_browser')
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
    if (source === 'reflector') return 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300'
    if (source === 'fallback' || source === 'fallback_browser')
        return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
    return 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'
}

function sourceBadgeLabel(source: string): string {
    if (source === 'coingecko_pro') return 'Pro'
    if (source === 'coingecko_free' || source === 'coingecko') return 'CoinGecko'
    if (source === 'coingecko_browser') return 'Browser CG'
    if (source === 'reflector') return 'Reflector'
    if (source === 'fallback_browser') return 'Browser fallback'
    if (source === 'fallback') return 'Fallback'
    return source || 'Unknown'
}

function normalizePrices(data: unknown): Record<string, PriceData> {
    const out: Record<string, PriceData> = {}
    if (!data || typeof data !== 'object') return out
    for (const asset of Object.keys(data as Record<string, unknown>)) {
        const assetData = (data as Record<string, unknown>)[asset]
        if (assetData && typeof assetData === 'object') {
            const o = assetData as Record<string, number | string | boolean | undefined>
            out[asset] = {
                price: Number(o.price ?? o.usd ?? 0),
                change: Number(o.change ?? o.usd_24h_change ?? 0),
                source: String(o.source ?? 'coingecko'),
                timestamp: Number(o.timestamp ?? Date.now() / 1000),
                volume: o.volume !== undefined ? Number(o.volume) : o.usd_24h_vol !== undefined ? Number(o.usd_24h_vol) : undefined,
                servedFromCache: typeof o.servedFromCache === 'boolean' ? o.servedFromCache : undefined,
                quoteAgeSeconds: o.quoteAgeSeconds !== undefined ? Number(o.quoteAgeSeconds) : undefined,
                dataTier: o.dataTier !== undefined ? String(o.dataTier) : undefined,
            }
        } else if (typeof assetData === 'number') {
            out[asset] = {
                price: assetData,
                change: 0,
                source: 'unknown',
                timestamp: Date.now() / 1000,
                volume: 0,
            }
        }
    }
    return out
}

function qualityMessage(meta: PriceFeedClientMeta | undefined): string | null {
    if (!meta) return null
    if (meta.degraded) {
        return 'Prices are synthetic or fallback data — do not treat as live exchange quotes.'
    }
    if (meta.staleOrLimited) {
        return 'Quotes may be stale or served from cache after an upstream error or rate limit.'
    }
    return null
}

const PriceTracker: React.FC<PriceTrackerProps> = ({ compact = false }) => {
    const { data: assetList = ['XLM', 'BTC', 'ETH', 'USDC'] } = useAssets()
    const { data: priceBundle, isLoading, error: queryError, refetch } = usePrices()
    const { state: realtimeState } = useRealtimeConnection()

    const prices = useMemo(() => normalizePrices(priceBundle?.prices), [priceBundle?.prices])
    const feedMeta = priceBundle?.feedMeta
    const qualityHint = useMemo(() => qualityMessage(feedMeta), [feedMeta])
    const loading = isLoading
    const isConnected = realtimeState === 'connected'
    const error =
        queryError instanceof Error ? queryError.message : queryError ? String(queryError) : null

    const lastUpdate = useMemo(() => {
        const vals = Object.values(prices)
        if (!vals.length) return '—'
        const maxTs = Math.max(
            ...vals.map((p) => (p.timestamp < 1e12 ? p.timestamp * 1000 : p.timestamp)),
        )
        if (!Number.isFinite(maxTs)) return '—'
        return new Date(maxTs).toLocaleTimeString()
    }, [prices])

    const retryConnection = () => {
        void refetch()
    }

    // Assets list is now handled by useAssets() React Query hook above.
    // This eliminates the manual useEffect fetch + setState pattern.

    if (loading && Object.keys(prices).length === 0) {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4 animate-pulse">
                    <div className="w-32 h-6 bg-gray-300 dark:bg-gray-700 rounded" />
                    <div className="w-24 h-4 bg-gray-300 dark:bg-gray-700 rounded" />
                </div>
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

    const assets = assetList.length > 0 ? assetList : Object.keys(prices)

    if (compact) {
        return (
            <div className="flex items-center space-x-4 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="flex items-center space-x-1">
                    {isConnected ? (
                        <Wifi className="w-4 h-4 text-green-500" />
                    ) : (
                        <WifiOff className="w-4 h-4 text-red-500" />
                    )}
                </div>
                {assets.map((asset) => {
                    const data = prices[asset]
                    if (!data) return null

                    return (
                        <div key={asset} className="flex items-center space-x-1">
                            <span className="text-sm font-medium">{asset}</span>
                            <span className="text-sm">
                                ${data.price < 1 ? data.price.toFixed(6) : data.price.toLocaleString()}
                            </span>
                            <span
                                className={`text-xs flex items-center ${data.change >= 0 ? 'text-green-600' : 'text-red-600'}`}
                            >
                                {data.change >= 0 ? (
                                    <TrendingUp className="w-3 h-3" />
                                ) : (
                                    <TrendingDown className="w-3 h-3" />
                                )}
                                {Math.abs(data.change).toFixed(2)}%
                            </span>
                        </div>
                    )
                })}
                <div className="text-xs text-gray-500 dark:text-gray-400">{lastUpdate}</div>
            </div>
        )
    }

    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Real-time Prices</h3>
                <div className="flex items-center space-x-2">
                    <div className="flex items-center space-x-1">
                        {isConnected ? (
                            <Wifi className="w-4 h-4 text-green-500" />
                        ) : (
                            <WifiOff className="w-4 h-4 text-red-500" />
                        )}
                        <span className={`text-xs ${isConnected ? 'text-green-600' : 'text-red-600'}`}>
                            {isConnected ? 'Connected' : 'Disconnected'}
                        </span>
                    </div>
                    {error && (
                        <div
                            className="text-xs text-red-500 bg-red-50 dark:bg-red-900/30 px-2 py-1 rounded cursor-pointer"
                            onClick={retryConnection}
                            onKeyDown={(e) => e.key === 'Enter' && retryConnection()}
                            role="button"
                            tabIndex={0}
                        >
                            {error} (Click to retry)
                        </div>
                    )}
                    <div className="text-sm text-gray-500 dark:text-gray-400">Last update: {lastUpdate}</div>
                </div>
            </div>

            {qualityHint && (
                <div
                    className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
                        feedMeta?.degraded
                            ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200'
                            : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-300'
                    }`}
                >
                    {qualityHint}
                </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {assets.map((asset) => {
                    const data = prices[asset]
                    if (!data)
                        return (
                            <div key={asset} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                                <div className="text-sm text-gray-500 dark:text-gray-400">Loading {asset}...</div>
                            </div>
                        )

                    return (
                        <div
                            key={asset}
                            className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                        >
                            <div className="flex items-center justify-between mb-2">
                                <span className="font-medium text-gray-900 dark:text-white">{asset}</span>
                                <div className={`px-2 py-1 rounded text-xs ${sourceBadgeClass(data.source)}`}>
                                    {sourceBadgeLabel(data.source)}
                                </div>
                            </div>

                            <div className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
                                ${data.price < 1 ? data.price.toFixed(6) : data.price.toLocaleString()}
                            </div>

                            <div className={`flex items-center ${data.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {data.change >= 0 ? (
                                    <TrendingUp className="w-4 h-4 mr-1" />
                                ) : (
                                    <TrendingDown className="w-4 h-4 mr-1" />
                                )}
                                <span className="font-medium">
                                    {data.change >= 0 ? '+' : ''}
                                    {data.change.toFixed(2)}%
                                </span>
                            </div>

                            {(data.volume ||
                                (data.quoteAgeSeconds !== undefined && Number.isFinite(data.quoteAgeSeconds)) ||
                                data.servedFromCache) && (
                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 space-y-0.5">
                                    {data.volume ? <div>Vol: ${data.volume.toLocaleString()}</div> : null}
                                    {data.quoteAgeSeconds !== undefined && Number.isFinite(data.quoteAgeSeconds) ? (
                                        <div>Quote age: {Math.round(data.quoteAgeSeconds)}s</div>
                                    ) : null}
                                    {data.servedFromCache ? <div>From app cache</div> : null}
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
                            type="button"
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
