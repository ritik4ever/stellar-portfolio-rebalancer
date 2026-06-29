import React, { useMemo, useState } from 'react'
import { ArrowLeftRight, TrendingUp, TrendingDown, Wifi, WifiOff } from 'lucide-react'
import { useAssets } from '../hooks/queries/useAssetsQuery'
import { usePrices, formatPriceFeedSummary } from '../hooks/queries/usePricesQuery'
import type { PriceFeedClientMeta } from '../hooks/queries/usePricesQuery'
import { useRealtimeConnection } from '../context/RealtimeConnectionContext'
import { calculateRelativeMovement } from '../utils/calculations'

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

interface ComparePanelProps {
    assets: string[]
    prices: Record<string, PriceData>
    assetA: string
    assetB: string
    onChangeA: (v: string) => void
    onChangeB: (v: string) => void
}

function AssetCompareCard({ label, asset, data }: { label: string; asset: string; data: PriceData | undefined }) {
    if (!data) {
        return (
            <div className="flex-1 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</div>
                <div className="text-sm text-gray-400 dark:text-gray-500">No data for {asset}</div>
            </div>
        )
    }
    return (
        <div className="flex-1 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</div>
            <div className="font-semibold text-gray-900 dark:text-white text-lg">{asset}</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                ${data.price < 1 ? data.price.toFixed(6) : data.price.toLocaleString()}
            </div>
            <div className={`flex items-center mt-1 text-sm font-medium ${data.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {data.change >= 0 ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
                {data.change >= 0 ? '+' : ''}{data.change.toFixed(2)}% (24h)
            </div>
            <div className={`mt-1 text-xs px-2 py-0.5 rounded inline-block ${sourceBadgeClass(data.source)}`}>
                {sourceBadgeLabel(data.source)}
            </div>
        </div>
    )
}

function ComparePanel({ assets, prices, assetA, assetB, onChangeA, onChangeB }: ComparePanelProps) {
    const dataA = prices[assetA]
    const dataB = prices[assetB]

    const relative = useMemo(() => {
        if (!dataA || !dataB) return null
        return calculateRelativeMovement(dataA.change, dataB.change)
    }, [dataA, dataB])

    const selectClass = 'text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500'

    return (
        <div className="mb-6 p-4 border border-indigo-200 dark:border-indigo-800 rounded-xl bg-indigo-50/40 dark:bg-indigo-950/20" role="region" aria-label="Asset comparison">
            <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Compare</span>
                <select
                    aria-label="Asset A"
                    value={assetA}
                    onChange={(e) => onChangeA(e.target.value)}
                    className={selectClass}
                >
                    {assets.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <ArrowLeftRight className="w-4 h-4 text-gray-400" aria-hidden="true" />
                <select
                    aria-label="Asset B"
                    value={assetB}
                    onChange={(e) => onChangeB(e.target.value)}
                    className={selectClass}
                >
                    {assets.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
                <AssetCompareCard label="Asset A" asset={assetA} data={dataA} />
                <AssetCompareCard label="Asset B" asset={assetB} data={dataB} />
            </div>

            {relative && assetA !== assetB && (
                <div className="mt-4 p-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm">
                    {relative.leader === 'equal' ? (
                        <span className="text-gray-600 dark:text-gray-300">
                            {assetA} and {assetB} moved identically over 24h.
                        </span>
                    ) : (
                        <span className={relative.leader === 'a' ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                            <strong>{relative.leader === 'a' ? assetA : assetB}</strong> outperformed{' '}
                            <strong>{relative.leader === 'a' ? assetB : assetA}</strong> by{' '}
                            <strong>{Math.abs(relative.relativeChange).toFixed(2)} pp</strong> over 24h.
                        </span>
                    )}
                </div>
            )}

            {assetA === assetB && (
                <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
                    Select two different assets to compare.
                </div>
            )}

            {(!dataA || !dataB) && assetA !== assetB && (
                <div className="mt-4 p-3 rounded-lg bg-gray-50 dark:bg-gray-700 text-xs text-gray-500 dark:text-gray-400">
                    Waiting for price data…
                </div>
            )}
        </div>
    )
}

const PriceTracker: React.FC<PriceTrackerProps> = ({ compact = false }) => {
    const { data: assetList = ['XLM', 'BTC', 'ETH', 'USDC'] } = useAssets()
    const { data: priceBundle, isLoading, error: queryError, refetch } = usePrices()
    const { state: realtimeState, reconnectInfo, statusDetail } = useRealtimeConnection()
    const [compareMode, setCompareMode] = useState(false)
    const [compareA, setCompareA] = useState('')
    const [compareB, setCompareB] = useState('')

    const prices = useMemo(() => normalizePrices(priceBundle?.prices), [priceBundle?.prices])
    const feedMeta = priceBundle?.feedMeta
    const hasLivePriceRows = Object.keys(prices).length > 0
    const priceSourceLabel = formatPriceFeedSummary(feedMeta, hasLivePriceRows, false)
    const qualityHint = useMemo(() => qualityMessage(feedMeta), [feedMeta])
    const loading = isLoading
    const isConnected = realtimeState === 'connected'
    const isPaused = realtimeState === 'paused'
    const isReconnecting = realtimeState === 'reconnecting' || realtimeState === 'connecting'
    const connectionLabel = isConnected
        ? 'Connected'
        : isPaused
          ? 'Paused'
          : isReconnecting
            ? reconnectInfo
                ? `Reconnecting (${reconnectInfo.attempt}/${reconnectInfo.maxAttempts})`
                : 'Reconnecting'
            : 'Disconnected'
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

    // useAssets returns AssetWithIssuer[] objects; extract symbol strings
    const assets: string[] = assetList.length > 0
        ? assetList.map((a) => (typeof a === 'string' ? a : (a as { symbol: string }).symbol))
        : Object.keys(prices)

    // Default compare selections once assets are known
    const effectiveA = compareA || assets[0] || ''
    const effectiveB = compareB || assets[1] || ''

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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-4">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Real-time Prices</h3>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 space-x-2">
                        <span>Source: {priceSourceLabel}</span>
                        <span>•</span>
                        <span>Updated: {lastUpdate}</span>
                    </div>
                </div>
                <div className="flex items-center space-x-2">
                    <button
                        type="button"
                        onClick={() => setCompareMode((v) => !v)}
                        aria-pressed={compareMode}
                        className={`flex items-center space-x-1 text-xs px-3 py-1 rounded border transition-colors ${
                            compareMode
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                        }`}
                    >
                        <ArrowLeftRight className="w-3 h-3" />
                        <span>Compare</span>
                    </button>
                    <div className="flex items-center space-x-1">
                        {isConnected ? (
                            <Wifi className="w-4 h-4 text-green-500" />
                        ) : (
                            <WifiOff className="w-4 h-4 text-red-500" />
                        )}
                        <span
                            className={`text-xs ${
                                isConnected
                                    ? 'text-green-600'
                                    : isPaused
                                      ? 'text-slate-600 dark:text-slate-400'
                                      : isReconnecting
                                        ? 'text-amber-600'
                                        : 'text-red-600'
                            }`}
                        >
                            {connectionLabel}
                        </span>
                    </div>
                    {statusDetail && !isConnected ? (
                        <span className="text-[11px] text-gray-500 dark:text-gray-400 max-w-[12rem] truncate">
                            {statusDetail}
                        </span>
                    ) : null}
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
                </div>
            </div>

            {qualityHint && (
                <div
                    className={`mb-4 rounded-lg border px-3 py-2 text-xs ${feedMeta?.degraded
                            ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200'
                            : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-300'
                        }`}
                >
                    {qualityHint}
                </div>
            )}

            {compareMode && (
                <ComparePanel
                    assets={assets}
                    prices={prices}
                    assetA={effectiveA}
                    assetB={effectiveB}
                    onChangeA={setCompareA}
                    onChangeB={setCompareB}
                />
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
                                {isPaused
                                    ? 'Live feed paused in the background. Showing last known prices.'
                                    : isReconnecting
                                      ? 'Reconnecting to live prices. Showing last known quotes until the socket is back.'
                                      : 'Connection lost. Showing last known prices.'}
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
