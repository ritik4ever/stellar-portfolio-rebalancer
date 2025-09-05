import { useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash2, ArrowLeft, AlertCircle, CheckCircle } from 'lucide-react'

interface PortfolioSetupProps {
    onNavigate: (view: string) => void
    publicKey: string | null
}

interface Allocation {
    asset: string
    percentage: number
}

const PortfolioSetup: React.FC<PortfolioSetupProps> = ({ onNavigate, publicKey }) => {
    const [allocations, setAllocations] = useState<Allocation[]>([
        { asset: 'XLM', percentage: 40 }
    ])
    const [threshold, setThreshold] = useState(5)
    const [autoRebalance, setAutoRebalance] = useState(true)
    const [isCreating, setIsCreating] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState(false)
    const [isDemoMode] = useState(true)

    const assetOptions = [
        { value: 'XLM', label: 'XLM (Stellar Lumens)' },
        { value: 'USDC', label: 'USDC (USD Coin)' },
        { value: 'BTC', label: 'BTC (Bitcoin)' },
        { value: 'ETH', label: 'ETH (Ethereum)' }
    ]

    const addAllocation = () => {
        const unusedAssets = assetOptions.filter(
            option => !allocations.some(alloc => alloc.asset === option.value)
        )

        if (unusedAssets.length > 0) {
            setAllocations([...allocations, { asset: unusedAssets[0].value, percentage: 0 }])
        }
    }

    const removeAllocation = (index: number) => {
        if (allocations.length > 1) {
            setAllocations(allocations.filter((_, i) => i !== index))
        }
    }

    const updateAllocation = (index: number, field: 'asset' | 'percentage', value: string | number) => {
        const updated = [...allocations]
        updated[index] = { ...updated[index], [field]: value }
        setAllocations(updated)
    }

    const totalPercentage = allocations.reduce((sum, alloc) => sum + alloc.percentage, 0)
    const isValidTotal = Math.abs(totalPercentage - 100) < 0.01

    const presetPortfolios = [
        {
            name: 'Conservative',
            allocations: [
                { asset: 'XLM', percentage: 50 },
                { asset: 'USDC', percentage: 40 },
                { asset: 'BTC', percentage: 10 }
            ]
        },
        {
            name: 'Balanced',
            allocations: [
                { asset: 'XLM', percentage: 40 },
                { asset: 'USDC', percentage: 35 },
                { asset: 'BTC', percentage: 25 }
            ]
        },
        {
            name: 'Aggressive',
            allocations: [
                { asset: 'BTC', percentage: 50 },
                { asset: 'ETH', percentage: 30 },
                { asset: 'XLM', percentage: 20 }
            ]
        }
    ]

    const applyPreset = (preset: typeof presetPortfolios[0]) => {
        setAllocations(preset.allocations)
    }

    const createPortfolio = async () => {
        if (!isValidTotal) {
            setError('Allocations must sum to 100%')
            return
        }

        if (!publicKey && !isDemoMode) {
            setError('Please connect your wallet first')
            return
        }

        setIsCreating(true)
        setError(null)

        try {
            const allocationsMap = allocations.reduce((acc, alloc) => {
                acc[alloc.asset] = alloc.percentage
                return acc
            }, {} as Record<string, number>)

            const response = await fetch('/api/portfolio', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userAddress: publicKey || 'demo-user',
                    allocations: allocationsMap,
                    threshold
                })
            })

            if (response.ok) {
                await response.json()
                setSuccess(true)
                setTimeout(() => {
                    onNavigate('dashboard')
                }, 2000)
            } else {
                const errorData = await response.json()
                setError(errorData.error || 'Failed to create portfolio')
            }
        } catch (err) {
            setError('Network error. Please try again.')
        } finally {
            setIsCreating(false)
        }
    }

    return (
        <div className="min-h-screen bg-gray-50 py-8">
            <div className="max-w-4xl mx-auto px-6">
                {/* Header */}
                <div className="flex items-center mb-8">
                    <button
                        onClick={() => onNavigate('dashboard')}
                        className="mr-4 p-2 text-gray-500 hover:text-gray-700 transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Create Portfolio</h1>
                        <p className="text-gray-600 mt-1">Set up your automated rebalancing strategy</p>
                    </div>
                </div>

                {/* Wallet Status */}
                <div className="bg-white rounded-xl p-6 shadow-sm mb-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Wallet Status</h3>
                    {publicKey ? (
                        <div className="flex items-center text-green-600">
                            <CheckCircle className="w-5 h-5 mr-2" />
                            <span>Connected: {publicKey.slice(0, 8)}...{publicKey.slice(-8)}</span>
                        </div>
                    ) : (
                        <div className="flex items-center text-yellow-600">
                            <AlertCircle className="w-5 h-5 mr-2" />
                            <span>Demo Mode Active</span>
                        </div>
                    )}
                </div>

                {/* Demo Mode Notice */}
                {isDemoMode && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                        <div className="flex items-center">
                            <div className="text-blue-600 mr-2">ℹ️</div>
                            <div>
                                <h4 className="text-blue-800 font-medium">Demo Mode</h4>
                                <p className="text-blue-700 text-sm">
                                    Using simulated $10,000 portfolio with real price data.
                                    Perfect for testing and demonstrations.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Success Message */}
                {success && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6"
                    >
                        <div className="flex items-center text-green-800">
                            <CheckCircle className="w-5 h-5 mr-2" />
                            <span>Portfolio created successfully! Redirecting to dashboard...</span>
                        </div>
                    </motion.div>
                )}

                {/* Error Message */}
                {error && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6"
                    >
                        <div className="flex items-center text-red-800">
                            <AlertCircle className="w-5 h-5 mr-2" />
                            <span>{error}</span>
                        </div>
                    </motion.div>
                )}

                <div className="grid lg:grid-cols-2 gap-8">
                    {/* Left Column - Configuration */}
                    <div className="space-y-6">
                        {/* Preset Portfolios */}
                        <div className="bg-white rounded-xl p-6 shadow-sm">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Start</h3>
                            <div className="grid grid-cols-3 gap-3">
                                {presetPortfolios.map((preset, index) => (
                                    <button
                                        key={index}
                                        onClick={() => applyPreset(preset)}
                                        className="p-3 text-sm bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors text-center"
                                    >
                                        <div className="font-medium">{preset.name}</div>
                                        <div className="text-xs text-gray-500 mt-1">
                                            {preset.allocations.length} assets
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Asset Allocations */}
                        <div className="bg-white rounded-xl p-6 shadow-sm">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold text-gray-900">Asset Allocations</h3>
                                <button
                                    onClick={addAllocation}
                                    disabled={allocations.length >= assetOptions.length}
                                    className="flex items-center px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm rounded-lg transition-colors"
                                >
                                    <Plus className="w-4 h-4 mr-1" />
                                    Add Asset
                                </button>
                            </div>

                            <div className="space-y-4">
                                {allocations.map((allocation, index) => (
                                    <div key={index} className="flex items-center space-x-3">
                                        <div className="flex-1">
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                Asset
                                            </label>
                                            <select
                                                value={allocation.asset}
                                                onChange={(e) => updateAllocation(index, 'asset', e.target.value)}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            >
                                                {assetOptions.map(option => (
                                                    <option key={option.value} value={option.value}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="w-24">
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                Percentage
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                max="100"
                                                step="0.1"
                                                value={allocation.percentage}
                                                onChange={(e) => updateAllocation(index, 'percentage', parseFloat(e.target.value) || 0)}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            />
                                        </div>
                                        {allocations.length > 1 && (
                                            <button
                                                onClick={() => removeAllocation(index)}
                                                className="mt-6 p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <div className="mt-4 pt-4 border-t border-gray-200">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-gray-700">Total Allocation:</span>
                                    <span className={`font-semibold ${isValidTotal ? 'text-green-600' : 'text-red-600'}`}>
                                        {totalPercentage.toFixed(1)}%
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Rebalance Settings */}
                        <div className="bg-white rounded-xl p-6 shadow-sm">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4">Rebalance Settings</h3>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Rebalance Threshold (%)
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="50"
                                        value={threshold}
                                        onChange={(e) => setThreshold(parseInt(e.target.value) || 5)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    />
                                    <p className="text-sm text-gray-500 mt-1">
                                        Trigger rebalance when any asset drifts by this percentage
                                    </p>
                                </div>

                                <div className="flex items-center">
                                    <input
                                        type="checkbox"
                                        id="autoRebalance"
                                        checked={autoRebalance}
                                        onChange={(e) => setAutoRebalance(e.target.checked)}
                                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                    />
                                    <label htmlFor="autoRebalance" className="ml-2 text-sm text-gray-700">
                                        Enable automatic rebalancing
                                    </label>
                                </div>
                                <p className="text-sm text-gray-500">
                                    Automatically execute rebalances when threshold is exceeded
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Right Column - Preview */}
                    <div className="bg-white rounded-xl p-6 shadow-sm">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Portfolio Preview</h3>

                        {/* Allocation Chart Preview */}
                        <div className="space-y-3 mb-6">
                            {allocations.map((allocation, index) => (
                                <div key={index} className="flex items-center justify-between">
                                    <div className="flex items-center">
                                        <div
                                            className={`w-4 h-4 rounded-full mr-3`}
                                            style={{ backgroundColor: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444'][index] || '#6B7280' }}
                                        />
                                        <span className="font-medium">{allocation.asset}</span>
                                    </div>
                                    <span className="text-gray-600">{allocation.percentage}%</span>
                                </div>
                            ))}
                        </div>

                        {/* Settings Summary */}
                        <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                            <div className="flex justify-between">
                                <span className="text-sm text-gray-600">Rebalance Threshold:</span>
                                <span className="text-sm font-medium">{threshold}%</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-sm text-gray-600">Auto-Rebalance:</span>
                                <span className="text-sm font-medium">{autoRebalance ? 'Enabled' : 'Disabled'}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-sm text-gray-600">Portfolio Value:</span>
                                <span className="text-sm font-medium">$10,000 (Demo)</span>
                            </div>
                        </div>

                        {/* Create Button */}
                        <button
                            onClick={createPortfolio}
                            disabled={!isValidTotal || isCreating}
                            className="w-full mt-6 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center"
                        >
                            {isCreating ? (
                                <>
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                    Creating...
                                </>
                            ) : (
                                'Create Portfolio'
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default PortfolioSetup