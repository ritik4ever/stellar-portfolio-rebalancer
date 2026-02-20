import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, Shield, Zap, ArrowRight, X } from 'lucide-react'
import ThemeToggle from './ThemeToggle'
import { WalletSelector } from './WalletSelector'

interface LandingProps {
    onNavigate: (view: string) => void
    onConnectWallet: () => Promise<void>
    isConnecting: boolean
    publicKey: string | null
}

const Landing: React.FC<LandingProps> = ({ onNavigate, onConnectWallet, isConnecting, publicKey }) => {
    const [showWalletSelector, setShowWalletSelector] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleConnectWallet = async () => {
        setShowWalletSelector(true)
        setError(null)
    }

    const handleWalletSelected = async (_publicKey: string) => {
        setShowWalletSelector(false)
        await onConnectWallet()
    }

    const handleWalletError = (errorMsg: string) => {
        setError(errorMsg)
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
            {/* Header */}
            <nav className="flex items-center justify-between p-6 max-w-7xl mx-auto">
                <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                        <TrendingUp className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-xl font-bold text-gray-900 dark:text-white">Portfolio Rebalancer</span>
                </div>
                <div className="flex items-center space-x-4">
                    <ThemeToggle />
                    {publicKey ? (
                        <button
                            onClick={() => onNavigate('dashboard')}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
                        >
                            Go to Dashboard
                        </button>
                    ) : (
                        <button
                            onClick={handleConnectWallet}
                            disabled={isConnecting}
                            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg transition-colors flex items-center"
                        >
                            Connect Wallet
                        </button>
                    )}
                </div>
            </nav>

            {/* Hero Section */}
            <div className="max-w-7xl mx-auto px-6 py-20">
                <div className="text-center">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8 }}
                    >
                        <h1 className="text-5xl md:text-7xl font-bold text-gray-900 dark:text-white mb-6">
                            Smart Portfolio <span className="text-blue-600">Rebalancing</span>
                        </h1>
                        <p className="text-xl text-gray-600 dark:text-gray-300 mb-8 max-w-3xl mx-auto leading-relaxed">
                            Maintain optimal asset allocation automatically with our intelligent rebalancing
                            protocol. Powered by Stellar's ecosystem and Reflector's reliable price oracles.
                        </p>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, delay: 0.2 }}
                        className="flex flex-col sm:flex-row gap-4 justify-center items-center"
                    >
                        <button
                            onClick={handleConnectWallet}
                            disabled={isConnecting}
                            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-8 py-4 rounded-xl font-semibold text-lg transition-colors flex items-center"
                        >
                            {isConnecting ? (
                                <>
                                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-3"></div>
                                    Connecting...
                                </>
                            ) : (
                                <>
                                    Connect Wallet to Start
                                    <ArrowRight className="w-5 h-5 ml-2" />
                                </>
                            )}
                        </button>
                        <button
                            onClick={() => onNavigate('dashboard')}
                            className="bg-white hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 px-8 py-4 rounded-xl font-semibold text-lg transition-colors"
                        >
                            View Demo
                        </button>
                    </motion.div>
                </div>

                {/* Features Section */}
                <motion.div
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.4 }}
                    className="mt-32"
                >
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-4">
                            Why Choose Our Platform?
                        </h2>
                        <p className="text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
                            Built for the next generation of DeFi with enterprise-grade security and user-friendly design
                        </p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-8">
                        <motion.div
                            whileHover={{ y: -5 }}
                            className="bg-white dark:bg-gray-800 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all duration-300"
                        >
                            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/50 rounded-xl flex items-center justify-center mb-6">
                                <TrendingUp className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                            </div>
                            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Smart Rebalancing</h3>
                            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                                Automatically maintain your target allocations with intelligent threshold-based rebalancing
                                that saves you time and reduces emotional trading decisions.
                            </p>
                        </motion.div>

                        <motion.div
                            whileHover={{ y: -5 }}
                            className="bg-white dark:bg-gray-800 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all duration-300"
                        >
                            <div className="w-12 h-12 bg-green-100 dark:bg-green-900/50 rounded-xl flex items-center justify-center mb-6">
                                <Shield className="w-6 h-6 text-green-600 dark:text-green-400" />
                            </div>
                            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Risk Management</h3>
                            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                                Built-in safeguards and circuit breakers protect your portfolio from extreme market
                                conditions and prevent concentration risk.
                            </p>
                        </motion.div>

                        <motion.div
                            whileHover={{ y: -5 }}
                            className="bg-white dark:bg-gray-800 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all duration-300"
                        >
                            <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/50 rounded-xl flex items-center justify-center mb-6">
                                <Zap className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                            </div>
                            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Real-time Oracle Data</h3>
                            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                                Powered by Reflector's decentralized price feeds for accurate, manipulation-resistant
                                pricing data from multiple sources.
                            </p>
                        </motion.div>
                    </div>
                </motion.div>
            </div>

            {showWalletSelector && (
                <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 flex items-center justify-center z-50 p-4">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-md w-full shadow-xl"
                    >
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Select Wallet</h2>
                            <button
                                onClick={() => {
                                    setShowWalletSelector(false)
                                    setError(null)
                                }}
                                className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        {error && (
                            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-300 text-sm">
                                {error}
                            </div>
                        )}
                        <WalletSelector
                            onConnect={handleWalletSelected}
                            onError={handleWalletError}
                        />
                    </motion.div>
                </div>
            )}
        </div>
    )
}

export default Landing
