import React from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, RefreshCw, AlertCircle } from 'lucide-react'
import { useMarketMovers } from '../hooks/queries/useMarketMoversQuery'

export const MarketMovers: React.FC = () => {
    const { data, isLoading, isError, error, refetch, isRefetching } = useMarketMovers()

    const containerVariants = {
        hidden: { opacity: 0, y: 10 },
        visible: {
            opacity: 1,
            y: 0,
            transition: {
                staggerChildren: 0.05
            }
        }
    }

    const itemVariants = {
        hidden: { opacity: 0, x: -10 },
        visible: { opacity: 1, x: 0 }
    }

    if (isLoading) {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700/50 animate-pulse">
                <div className="flex items-center justify-between mb-4">
                    <div className="w-36 h-6 bg-gray-300 dark:bg-gray-700 rounded" />
                    <div className="w-16 h-4 bg-gray-300 dark:bg-gray-700 rounded" />
                </div>
                <div className="grid md:grid-cols-2 gap-6">
                    <div>
                        <div className="w-24 h-5 bg-gray-300 dark:bg-gray-700 rounded mb-3" />
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="h-12 bg-gray-200 dark:bg-gray-700/50 rounded mb-2" />
                        ))}
                    </div>
                    <div>
                        <div className="w-24 h-5 bg-gray-300 dark:bg-gray-700 rounded mb-3" />
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="h-12 bg-gray-200 dark:bg-gray-700/50 rounded mb-2" />
                        ))}
                    </div>
                </div>
            </div>
        )
    }

    if (isError) {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-red-100 dark:border-red-900/20">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-red-500" />
                        Market Movers (24h)
                    </h3>
                    <button
                        type="button"
                        onClick={() => void refetch()}
                        className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-500 dark:text-gray-400 transition-colors"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>
                <p className="text-sm text-red-600 dark:text-red-400">
                    Failed to load market movers: {error instanceof Error ? error.message : 'Unknown error'}
                </p>
            </div>
        )
    }

    const gainers = data?.gainers || []
    const losers = data?.losers || []

    const isEmpty = gainers.length === 0 && losers.length === 0

    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700/50">
            <div className="flex items-center justify-between mb-5">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Market Movers</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Top gainers and losers over the last 24 hours</p>
                </div>
                <button
                    type="button"
                    onClick={() => void refetch()}
                    disabled={isRefetching}
                    className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 rounded-lg text-gray-500 dark:text-gray-400 transition-colors flex items-center gap-1"
                    title="Refresh data"
                >
                    <RefreshCw className={`w-4 h-4 ${isRefetching ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {isEmpty ? (
                <div className="text-center py-6 text-sm text-gray-500 dark:text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
                    No 24h market mover data available at this time.
                </div>
            ) : (
                <div className="grid md:grid-cols-2 gap-6">
                    {/* Gainers */}
                    <div>
                        <div className="flex items-center gap-2 mb-3 pb-1 border-b border-gray-100 dark:border-gray-700/50">
                            <TrendingUp className="w-4 h-4 text-green-500" />
                            <span className="text-sm font-semibold text-green-600 dark:text-green-400 uppercase tracking-wider">Top Gainers</span>
                        </div>
                        {gainers.length === 0 ? (
                            <div className="text-sm text-gray-400 dark:text-gray-500 py-3">No gainers over the last 24h.</div>
                        ) : (
                            <motion.div
                                className="space-y-2"
                                variants={containerVariants}
                                initial="hidden"
                                animate="visible"
                            >
                                {gainers.map((mover) => (
                                    <motion.div
                                        key={mover.symbol}
                                        variants={itemVariants}
                                        whileHover={{ scale: 1.01, x: 2 }}
                                        className="flex items-center justify-between p-3 rounded-lg bg-green-50/30 hover:bg-green-50/60 dark:bg-green-950/10 dark:hover:bg-green-950/20 border border-green-100/50 dark:border-green-900/20 transition-all"
                                    >
                                        <div>
                                            <div className="font-semibold text-gray-900 dark:text-white text-sm">{mover.symbol}</div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[150px]">{mover.name}</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="font-semibold text-gray-900 dark:text-white text-sm">
                                                ${mover.price < 1 ? mover.price.toFixed(6) : mover.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </div>
                                            <div className="text-xs font-semibold text-green-600 dark:text-green-400 flex items-center justify-end gap-0.5">
                                                +{mover.change24h.toFixed(2)}%
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </motion.div>
                        )}
                    </div>

                    {/* Losers */}
                    <div>
                        <div className="flex items-center gap-2 mb-3 pb-1 border-b border-gray-100 dark:border-gray-700/50">
                            <TrendingDown className="w-4 h-4 text-red-500" />
                            <span className="text-sm font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider">Top Losers</span>
                        </div>
                        {losers.length === 0 ? (
                            <div className="text-sm text-gray-400 dark:text-gray-500 py-3">No losers over the last 24h.</div>
                        ) : (
                            <motion.div
                                className="space-y-2"
                                variants={containerVariants}
                                initial="hidden"
                                animate="visible"
                            >
                                {losers.map((mover) => (
                                    <motion.div
                                        key={mover.symbol}
                                        variants={itemVariants}
                                        whileHover={{ scale: 1.01, x: 2 }}
                                        className="flex items-center justify-between p-3 rounded-lg bg-red-50/30 hover:bg-red-50/60 dark:bg-red-950/10 dark:hover:bg-red-950/20 border border-red-100/50 dark:border-red-900/20 transition-all"
                                    >
                                        <div>
                                            <div className="font-semibold text-gray-900 dark:text-white text-sm">{mover.symbol}</div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[150px]">{mover.name}</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="font-semibold text-gray-900 dark:text-white text-sm">
                                                ${mover.price < 1 ? mover.price.toFixed(6) : mover.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </div>
                                            <div className="text-xs font-semibold text-red-600 dark:text-red-400 flex items-center justify-end gap-0.5">
                                                {mover.change24h.toFixed(2)}%
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </motion.div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
