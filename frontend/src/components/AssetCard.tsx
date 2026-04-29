import React from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'

interface AssetCardProps {
    asset?: {
        name: string
        value: number
        amount: number
        color: string
    }
    price?: {
        price: number | null
        change: number | null
    } | null
    // NEW: Loading skeleton prop
    isLoading?: boolean
}

const AssetCard: React.FC<AssetCardProps> = ({ asset, price, isLoading = false }) => {
    // NEW: Render skeleton loading state
    if (isLoading) {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 animate-pulse">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center">
                        {/* Skeleton circle avatar */}
                        <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-700" />
                        <div className="ml-3 space-y-2">
                            <div className="w-24 h-4 bg-gray-300 dark:bg-gray-700 rounded" />
                            <div className="w-32 h-3 bg-gray-300 dark:bg-gray-700 rounded" />
                        </div>
                    </div>
                    {/* Skeleton trend indicator */}
                    <div className="w-12 h-6 bg-gray-300 dark:bg-gray-700 rounded" />
                </div>

                <div className="space-y-2">
                    {/* Skeleton value rows */}
                    <div className="flex justify-between">
                        <div className="w-12 h-3 bg-gray-300 dark:bg-gray-700 rounded" />
                        <div className="w-20 h-3 bg-gray-300 dark:bg-gray-700 rounded" />
                    </div>
                    <div className="flex justify-between">
                        <div className="w-12 h-3 bg-gray-300 dark:bg-gray-700 rounded" />
                        <div className="w-20 h-3 bg-gray-300 dark:bg-gray-700 rounded" />
                    </div>
                    <div className="flex justify-between">
                        <div className="w-12 h-3 bg-gray-300 dark:bg-gray-700 rounded" />
                        <div className="w-20 h-3 bg-gray-300 dark:bg-gray-700 rounded" />
                    </div>
                    {/* Skeleton progress bar */}
                    <div className="w-full bg-gray-300 dark:bg-gray-700 rounded-full h-2 mt-2" />
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
    const isNeutral = changeValue === 0

    const priceValue = price?.price
    const hasPrice = typeof priceValue === 'number'
    const formattedPrice = hasPrice
        ? new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: 'USD',
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
          }).format(priceValue)
        : 'N/A'

    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                    <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                        style={{ backgroundColor: asset.color }}
                    >
                        {asset.name.charAt(0)}
                    </div>
                    <div className="ml-3">
                        <h3 className="font-semibold text-gray-900 dark:text-white">{asset.name}</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{asset.value}% allocation</p>
                    </div>
                </div>
                <div className={`flex items-center ${isPositive ? 'text-green-500' : isNegative ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}>
                    {isPositive && <TrendingUp className="w-4 h-4 mr-1" data-testid="trend-up" />}
                    {isNegative && <TrendingDown className="w-4 h-4 mr-1" data-testid="trend-down" />}
                    {isNeutral && <span className="w-4 h-4 mr-1 flex items-center justify-center font-bold" data-testid="trend-neutral">-</span>}
                    <span className="text-sm font-medium" data-testid="drift-value">
                        {hasChange ? `${isPositive ? '+' : ''}${changeValue.toFixed(2)}%` : 'N/A'}
                    </span>
                </div>
            </div>

            <div className="space-y-2">
                <div className="flex justify-between">
                    <span className="text-sm text-gray-500 dark:text-gray-400">Value</span>
                    <span className="font-medium dark:text-gray-200">${asset.amount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-sm text-gray-500 dark:text-gray-400">Price</span>
                    <span className="text-sm text-gray-600 dark:text-gray-300" data-testid="price-value">{formattedPrice}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-sm text-gray-500 dark:text-gray-400">Target</span>
                    <span className="text-sm text-gray-600 dark:text-gray-300">{asset.value}%</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mt-2">
                    <div
                        className="h-2 rounded-full"
                        style={{
                            width: `${asset.value}%`,
                            backgroundColor: asset.color
                        }}
                    />
                </div>
            </div>
        </div>
    )
}

export default AssetCard