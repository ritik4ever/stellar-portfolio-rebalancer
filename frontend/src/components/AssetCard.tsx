import React from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'

interface AssetCardProps {
    asset: {
        name: string
        value: number
        amount: number
        color: string
    }
    price?: {
        price: number
        change: number
    }
}

const AssetCard: React.FC<AssetCardProps> = ({ asset, price }) => {
    const change = price?.change || (Math.random() * 10 - 5)
    const isPositive = change >= 0
    const currentPrice = price?.price || 1

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
                <div className={`flex items-center ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                    {isPositive ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
                    <span className="text-sm font-medium">{isPositive ? '+' : ''}{change.toFixed(2)}%</span>
                </div>
            </div>

            <div className="space-y-2">
                <div className="flex justify-between">
                    <span className="text-sm text-gray-500 dark:text-gray-400">Value</span>
                    <span className="font-medium dark:text-gray-200">${asset.amount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-sm text-gray-500 dark:text-gray-400">Price</span>
                    <span className="text-sm text-gray-600 dark:text-gray-300">${currentPrice.toFixed(currentPrice < 1 ? 4 : 2)}</span>
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
