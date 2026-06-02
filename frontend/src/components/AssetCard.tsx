import React from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { assetCardCopy } from '../content/uiCopy'
import { formatUsd, formatNumber } from '../utils/localeFormat'

interface AssetCardProps {
    asset?: {
        name: string
        value: number
        amount: number
        color: string
        issuer?: string
        domain?: string
        type?: 'native' | 'credit_alphanum4' | 'credit_alphanum12'
    }
    price?: {
        price: number | null
        change: number | null
        source?: string
        quoteAgeSeconds?: number
        servedFromCache?: boolean
        dataTier?: string
    } | null

    isLoading?: boolean
}

function getFallbackLabel(price?: AssetCardProps['price']): string | null {
    if (!price) return null
    if (price.source?.includes('fallback')) {
        return assetCardCopy.fallbackPrice
    }
    if (price.source?.includes('cached') || price.servedFromCache) {
        return assetCardCopy.cachedPrice
    }
    if (price.source === 'reflector') {
        return 'Server quote'
    }
    if (price.source === 'coingecko_browser') {
        return 'Browser quote'
    }
    if (price.source) {
        return price.source.replace(/_/g, ' ')
    }
    return null
}

const AssetCard: React.FC<AssetCardProps> = ({ asset, price, isLoading = false }) => {
    if (isLoading) {
        return (
            <div
                className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 shadow-sm border border-gray-100 dark:border-gray-700 motion-safe:animate-pulse"
                aria-busy="true"
                aria-label="Loading asset"
            >
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                    <div className="flex items-center">
                        <div className="w-8 sm:w-10 h-8 sm:h-10 rounded-full bg-gray-300 dark:bg-gray-700" />
                        <div className="ml-2 sm:ml-3 space-y-1 sm:space-y-2">
                            <div className="w-16 sm:w-24 h-3 sm:h-4 bg-gray-300 dark:bg-gray-700 rounded" />
                            <div className="w-20 sm:w-32 h-2 sm:h-3 bg-gray-300 dark:bg-gray-700 rounded" />
                        </div>
                    </div>
                    <div className="w-10 sm:w-12 h-5 sm:h-6 bg-gray-300 dark:bg-gray-700 rounded" />
                </div>
                <div className="space-y-1 sm:space-y-2">
                    {[1, 2, 3].map((row) => (
                        <div key={row} className="flex justify-between">
                            <div className="w-10 sm:w-12 h-2 sm:h-3 bg-gray-300 dark:bg-gray-700 rounded" />
                            <div className="w-16 sm:w-20 h-2 sm:h-3 bg-gray-300 dark:bg-gray-700 rounded" />
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    if (!asset) {
        return null
    }

    const changeValue = typeof price?.change === 'number' ? price.change : 0
    const hasChange = typeof price?.change === 'number'
    const isPositive = changeValue > 0
    const isNegative = changeValue < 0
    const isNeutral = hasChange && changeValue === 0

    const priceValue = price?.price
    const hasPrice = typeof priceValue === 'number'
    const formattedPrice = hasPrice ? formatUsd(priceValue) : 'N/A'

    const priceLabel = !hasPrice
        ? assetCardCopy.missingQuote
        : getFallbackLabel(price) ?? assetCardCopy.liveQuote

    const priceCaption = price?.quoteAgeSeconds !== undefined && Number.isFinite(price.quoteAgeSeconds)
        ? assetCardCopy.updatedAgo(Math.round(price.quoteAgeSeconds))
        : null

    const cardLabel = `${asset.name} allocation ${asset.value} percent`

    return (
        <article
            className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 shadow-sm border border-gray-100 dark:border-gray-700 dashboard-card"
            aria-label={cardLabel}
        >
            <div className="flex items-center justify-between mb-3 sm:mb-4">
                <div className="flex items-center min-w-0 flex-1">
                    <div
                        className="w-8 sm:w-10 h-8 sm:h-10 rounded-full flex items-center justify-center text-white font-bold text-sm sm:text-base flex-shrink-0"
                        style={{ backgroundColor: asset.color }}
                        aria-hidden
                    >
                        {asset.name.charAt(0)}
                    </div>
                    <div className="ml-2 sm:ml-3 min-w-0">
                        <h3 className="font-semibold text-gray-900 dark:text-white text-sm sm:text-base truncate">{asset.name}</h3>
                        <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">{assetCardCopy.allocation(asset.value)}</p>
                        {asset.issuer && (
                            <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                                {asset.domain ? (
                                    <span className="text-blue-600 dark:text-blue-400">{asset.domain}</span>
                                ) : (
                                    <span>{assetCardCopy.issuerPrefix}: {asset.issuer.slice(0, 4)}…{asset.issuer.slice(-4)}</span>
                                )}
                            </p>
                        )}
                        {asset.type === 'native' && (
                            <p className="text-xs text-blue-600 dark:text-blue-400">{assetCardCopy.nativeAsset}</p>
                        )}
                    </div>
                </div>
                <div
                    className={`flex items-center flex-shrink-0 ${isPositive ? 'text-green-500' : isNegative ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}
                    aria-label={hasChange ? `24 hour change ${changeValue.toFixed(2)} percent` : '24 hour change unavailable'}
                >
                    {isPositive && <TrendingUp className="w-3 sm:w-4 h-3 sm:h-4 mr-0.5 sm:mr-1" data-testid="trend-up" aria-hidden />}
                    {isNegative && <TrendingDown className="w-3 sm:w-4 h-3 sm:h-4 mr-0.5 sm:mr-1" data-testid="trend-down" aria-hidden />}
                    {isNeutral && (
                        <span className="w-3 sm:w-4 h-3 sm:h-4 mr-0.5 sm:mr-1 flex items-center justify-center font-bold text-xs sm:text-sm" data-testid="trend-neutral" aria-hidden>
                            -
                        </span>
                    )}
                    <span className="text-xs sm:text-sm font-medium" data-testid="drift-value">
                        {hasChange ? `${isPositive ? '+' : ''}${changeValue.toFixed(2)}%` : 'N/A'}
                    </span>
                </div>
            </div>

            <dl className="space-y-1 sm:space-y-2">
                <div className="flex justify-between">
                    <dt className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">{assetCardCopy.value}</dt>
                    <dd className="text-xs sm:text-sm font-medium dark:text-gray-200">${formatNumber(asset.amount)}</dd>
                </div>
                <div className="flex justify-between items-end">
                    <div>
                        <dt className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">{assetCardCopy.price}</dt>
                        <dd className="text-xs text-gray-500 dark:text-gray-400">{priceLabel}</dd>
                    </div>
                    <div className="text-right">
                        <dd className="text-sm text-gray-600 dark:text-gray-300" data-testid="price-value">
                            {formattedPrice}
                        </dd>
                        {priceCaption ? (
                            <dd className="text-[11px] text-gray-400 dark:text-gray-500">{priceCaption}</dd>
                        ) : null}
                    </div>
                </div>
                <div className="flex justify-between">
                    <dt className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">{assetCardCopy.target}</dt>
                    <dd className="text-xs sm:text-sm text-gray-600 dark:text-gray-300">{asset.value}%</dd>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 sm:h-2 mt-1 sm:mt-2" role="presentation">
                    <div
                        className="h-1.5 sm:h-2 rounded-full"
                        style={{
                            width: `${asset.value}%`,
                            backgroundColor: asset.color,
                        }}
                    />
                </div>
            </dl>
        </article>
    )
}

export default AssetCard
