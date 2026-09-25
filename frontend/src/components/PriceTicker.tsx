import React, { useEffect, useRef, useState } from 'react'
import { TrendingUp, TrendingDown, Minus, X, RefreshCw } from 'lucide-react'
import { usePrices } from '../hooks/queries/usePricesQuery'
import { useAssets } from '../hooks/queries/useAssetsQuery'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TickerItem {
    symbol: string
    name: string
    price: number | null
    change: number | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DISMISSED_KEY = 'price_ticker_dismissed'
const REFETCH_INTERVAL_MS = 30_000

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPrice(price: number): string {
    if (price >= 1_000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    if (price >= 1) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
    return price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })
}

function formatChange(change: number): string {
    const abs = Math.abs(change).toFixed(2)
    return `${change >= 0 ? '+' : '−'}${abs}%`
}

// ─── TickerItem component ─────────────────────────────────────────────────────

const TickerItemPill: React.FC<{ item: TickerItem }> = ({ item }) => {
    const hasChange = item.change !== null
    const isPositive = hasChange && item.change! > 0
    const isNegative = hasChange && item.change! < 0

    const changeColor = isPositive
        ? 'text-emerald-400'
        : isNegative
            ? 'text-red-400'
            : 'text-gray-400'

    const ChangeIcon = isPositive
        ? TrendingUp
        : isNegative
            ? TrendingDown
            : Minus

    return (
        <span
            className="inline-flex items-center gap-2 px-4 whitespace-nowrap select-none"
            aria-label={`${item.name} price ${item.price !== null ? `$${formatPrice(item.price)}` : 'unavailable'}, 24h change ${item.change !== null ? formatChange(item.change) : 'unavailable'}`}
        >
            {/* Asset name */}
            <span className="font-semibold text-white text-xs tracking-wide">
                {item.symbol}
            </span>
            <span className="text-gray-400 text-xs hidden sm:inline">{item.name}</span>

            {/* Price */}
            {item.price !== null ? (
                <span className="text-white text-xs font-mono">
                    ${formatPrice(item.price)}
                </span>
            ) : (
                <span className="text-gray-500 text-xs font-mono">N/A</span>
            )}

            {/* 24h change */}
            {item.change !== null ? (
                <span className={`flex items-center gap-0.5 text-xs font-medium ${changeColor}`}>
                    <ChangeIcon className="w-3 h-3" aria-hidden />
                    {formatChange(item.change)}
                </span>
            ) : null}

            {/* Separator dot */}
            <span className="text-gray-600 text-xs" aria-hidden>•</span>
        </span>
    )
}

// ─── Main PriceTicker component ───────────────────────────────────────────────

const PriceTicker: React.FC = () => {
    // Respect dismissed state from localStorage
    const [dismissed, setDismissed] = useState<boolean>(() => {
        try {
            return localStorage.getItem(DISMISSED_KEY) === 'true'
        } catch {
            return false
        }
    })

    const trackRef = useRef<HTMLDivElement>(null)

    // Pause scroll on hover/focus for accessibility
    const [paused, setPaused] = useState(false)

    const { data: priceBundle, isLoading, isError, refetch, dataUpdatedAt } = usePrices()
    const { data: assetList } = useAssets()

    // Override refetch interval to 30s (usePrices defaults to 60s)
    useEffect(() => {
        if (dismissed) return
        const id = setInterval(() => { void refetch() }, REFETCH_INTERVAL_MS)
        return () => clearInterval(id)
    }, [dismissed, refetch])

    // Persist dismissal to localStorage
    const handleDismiss = () => {
        try {
            localStorage.setItem(DISMISSED_KEY, 'true')
        } catch {
            // storage unavailable — dismiss in-memory only
        }
        setDismissed(true)
    }

    if (dismissed) return null

    // ── Build ticker items ──────────────────────────────────────────────────
    const prices = priceBundle?.prices ?? {}

    const items: TickerItem[] = (assetList ?? []).map((asset) => {
        const raw = prices[asset.symbol]
        const priceVal = raw && typeof raw === 'object' && 'price' in raw
            ? (raw as { price?: unknown }).price
            : typeof raw === 'number' ? raw : null
        const changeVal = raw && typeof raw === 'object' && 'change' in raw
            ? (raw as { change?: unknown }).change
            : null

        return {
            symbol: asset.symbol,
            name: asset.name ?? asset.symbol,
            price: typeof priceVal === 'number' && isFinite(priceVal) ? priceVal : null,
            change: typeof changeVal === 'number' && isFinite(changeVal) ? changeVal : null,
        }
    })

    // ── Render: loading ─────────────────────────────────────────────────────
    if (isLoading && items.length === 0) {
        return (
            <div
                role="status"
                aria-label="Loading price ticker"
                className="w-full bg-gray-900 border-b border-gray-700 h-9 flex items-center px-4 gap-4 overflow-hidden"
            >
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex items-center gap-2 animate-pulse">
                        <div className="w-10 h-3 bg-gray-700 rounded" />
                        <div className="w-16 h-3 bg-gray-700 rounded" />
                        <div className="w-12 h-3 bg-gray-700 rounded" />
                    </div>
                ))}
            </div>
        )
    }

    // ── Render: error ───────────────────────────────────────────────────────
    if (isError && items.length === 0) {
        return (
            <div
                role="alert"
                className="w-full bg-gray-900 border-b border-gray-700 h-9 flex items-center justify-between px-4"
            >
                <span className="text-xs text-red-400 flex items-center gap-1.5">
                    <RefreshCw className="w-3 h-3" aria-hidden />
                    Price feed unavailable
                </span>
                <button
                    type="button"
                    onClick={handleDismiss}
                    aria-label="Dismiss price ticker"
                    className="p-1 text-gray-400 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                >
                    <X className="w-4 h-4" aria-hidden />
                </button>
            </div>
        )
    }

    // Duplicate items so the strip loops seamlessly
    const displayItems = [...items, ...items]

    const lastUpdated = dataUpdatedAt
        ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : null

    return (
        <div
            role="marquee"
            aria-label="Live asset price ticker"
            aria-live="off"
            className="relative w-full bg-gray-900 border-b border-gray-700 h-9 flex items-center overflow-hidden"
        >
            {/* Scrolling track */}
            <div
                ref={trackRef}
                className={`price-ticker-track flex items-center ${paused ? 'price-ticker-paused' : ''}`}
                onMouseEnter={() => setPaused(true)}
                onMouseLeave={() => setPaused(false)}
                onFocusCapture={() => setPaused(true)}
                onBlurCapture={() => setPaused(false)}
            >
                {displayItems.map((item, idx) => (
                    <TickerItemPill key={`${item.symbol}-${idx}`} item={item} />
                ))}
            </div>

            {/* Right-side fade + controls */}
            <div
                className="absolute right-0 top-0 h-full flex items-center pl-12 pr-2 bg-gradient-to-l from-gray-900 via-gray-900/95 to-transparent pointer-events-none"
                aria-hidden
            />
            <div className="absolute right-2 top-0 h-full flex items-center gap-2 z-10">
                {lastUpdated && (
                    <span className="hidden sm:block text-xs text-gray-500 tabular-nums" aria-label={`Last updated at ${lastUpdated}`}>
                        {lastUpdated}
                    </span>
                )}
                <button
                    type="button"
                    onClick={handleDismiss}
                    aria-label="Dismiss price ticker"
                    className="p-1 text-gray-500 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                >
                    <X className="w-3.5 h-3.5" aria-hidden />
                </button>
            </div>
        </div>
    )
}

export default PriceTicker
