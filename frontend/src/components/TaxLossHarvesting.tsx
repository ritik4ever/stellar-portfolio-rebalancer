import React, { useState, useEffect, useCallback } from 'react'
import { api, ENDPOINTS } from '../config/api'
import { AlertCircle, RefreshCw, TrendingDown, Info, ShieldAlert } from 'lucide-react'

interface TaxCandidate {
    asset: string
    costBasis: number
    currentPrice: number
    lossPct: number
}

interface TaxLossHarvestingProps {
    portfolioId: string | null
}

export const TaxLossHarvesting: React.FC<TaxLossHarvestingProps> = ({ portfolioId }) => {
    const [thresholdPct, setThresholdPct] = useState<number>(5)
    const [candidates, setCandidates] = useState<TaxCandidate[]>([])
    const [loading, setLoading] = useState<boolean>(false)
    const [error, setError] = useState<string | null>(null)

    const fetchCandidates = useCallback(async () => {
        if (!portfolioId || portfolioId === 'demo') {
            setCandidates([])
            setLoading(false)
            return
        }

        setLoading(true)
        setError(null)
        try {
            const res = await api.get<{ candidates: TaxCandidate[] }>(
                ENDPOINTS.PORTFOLIO_TAX_LOSS_CANDIDATES(portfolioId, thresholdPct)
            )
            if (res && res.candidates) {
                setCandidates(res.candidates)
            } else {
                setCandidates([])
            }
        } catch (err: any) {
            setError(err?.message || 'Failed to fetch tax-loss harvesting candidates')
        } finally {
            setLoading(false)
        }
    }, [portfolioId, thresholdPct])

    useEffect(() => {
        fetchCandidates()
    }, [fetchCandidates])

    if (!portfolioId) {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
                <p className="text-gray-500 dark:text-gray-400 text-center">No portfolio selected.</p>
            </div>
        )
    }

    if (portfolioId === 'demo') {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex flex-col items-center justify-center text-center space-y-4">
                    <Info className="w-12 h-12 text-blue-500" />
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">Demo Mode</h3>
                    <p className="text-gray-500 dark:text-gray-400 max-w-md">
                        Tax-loss harvesting requires stored cost basis tracking on a live portfolio. Create a portfolio to track cost basis and preview loss harvesting opportunities.
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Warning advisory message */}
            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-2xl p-4 flex gap-3 text-amber-800 dark:text-amber-300">
                <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="text-sm">
                    <span className="font-semibold block mb-1">Advisory-Only Feature</span>
                    No trades are executed by this feature. This utility identifies assets in your portfolio that have dropped below their stored cost basis (purchase price) by more than the threshold to assist you with manual tax-loss harvesting.
                </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 space-y-6">
                {/* Control bar */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Tax-Loss Harvesting Candidates</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Advisory breakdown of assets trading below purchase cost basis.
                        </p>
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-auto">
                        <div className="flex items-center gap-2">
                            <label htmlFor="threshold-input" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Threshold:
                            </label>
                            <div className="relative rounded-lg shadow-sm w-24">
                                <input
                                    id="threshold-input"
                                    type="number"
                                    min="0.1"
                                    max="99"
                                    step="0.1"
                                    value={thresholdPct}
                                    onChange={(e) => setThresholdPct(parseFloat(e.target.value) || 5)}
                                    className="block w-full rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-950 dark:text-white pr-7 focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2"
                                />
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                                    <span className="text-gray-500 dark:text-gray-400 sm:text-sm">%</span>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={fetchCandidates}
                            disabled={loading}
                            className="inline-flex items-center justify-center p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 disabled:opacity-50 transition-colors"
                            title="Refresh candidates"
                        >
                            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>

                {/* Main section */}
                {loading ? (
                    <div className="space-y-4 py-8">
                        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/4 animate-pulse"></div>
                        <div className="h-12 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"></div>
                        <div className="h-12 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"></div>
                        <div className="h-12 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"></div>
                    </div>
                ) : error ? (
                    <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 rounded-xl text-red-600 dark:text-red-400">
                        <AlertCircle className="w-5 h-5 shrink-0" />
                        <span className="text-sm">{error}</span>
                    </div>
                ) : candidates.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-12 px-4 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl">
                        <div className="p-3 bg-green-50 dark:bg-green-950/20 text-green-600 dark:text-green-400 rounded-full mb-3">
                            <TrendingDown className="w-8 h-8 rotate-180" />
                        </div>
                        <h3 className="text-base font-semibold text-gray-900 dark:text-white">No harvesting candidates</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm">
                            None of your assets are currently trading at a loss exceeding your {thresholdPct}% threshold compared to their stored cost basis.
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                            <thead>
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Asset</th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Cost Basis Price</th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Current Price</th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Unrealized Loss</th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Action Advice</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                {candidates.map((candidate) => (
                                    <tr key={candidate.asset} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="font-bold text-gray-900 dark:text-white">{candidate.asset}</span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                            ${candidate.costBasis.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                            ${candidate.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-red-600 dark:text-red-400">
                                            -{candidate.lossPct.toFixed(2)}%
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-950/30 text-red-800 dark:text-red-300">
                                                Harvestable Loss
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}
