import React from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, Shield, Zap, ArrowRight } from 'lucide-react'

interface LandingProps {
    onNavigate: (view: string) => void
    onConnectWallet: () => Promise<void>
    isConnecting: boolean
    publicKey: string | null
}

const Landing: React.FC<LandingProps> = ({ onNavigate, onConnectWallet, isConnecting, publicKey }) => {
    const handleConnectWallet = async () => {
        try {
            await onConnectWallet()
        } catch (error) {
            // Error is handled in App.tsx
        }
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
            {/* Header */}
            <nav className="flex items-center justify-between p-6 max-w-7xl mx-auto">
                <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                        <TrendingUp className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-xl font-bold text-gray-900">Portfolio Rebalancer</span>
                </div>
                <div className="flex items-center space-x-4">
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
                            {isConnecting ? (
                                <>
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                    Connecting...
                                </>
                            ) : (
                                'Connect Wallet'
                            )}
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
                        <h1 className="text-5xl md:text-7xl font-bold text-gray-900 mb-6">
                            Smart Portfolio <span className="text-blue-600">Rebalancing</span>
                        </h1>
                        <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto leading-relaxed">
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
                            className="bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 px-8 py-4 rounded-xl font-semibold text-lg transition-colors"
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
                        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                            Why Choose Our Platform?
                        </h2>
                        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                            Built for the next generation of DeFi with enterprise-grade security and user-friendly design
                        </p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-8">
                        <motion.div
                            whileHover={{ y: -5 }}
                            className="bg-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all duration-300"
                        >
                            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mb-6">
                                <TrendingUp className="w-6 h-6 text-blue-600" />
                            </div>
                            <h3 className="text-xl font-semibold text-gray-900 mb-4">Smart Rebalancing</h3>
                            <p className="text-gray-600 leading-relaxed">
                                Automatically maintain your target allocations with intelligent threshold-based rebalancing
                                that saves you time and reduces emotional trading decisions.
                            </p>
                        </motion.div>

                        <motion.div
                            whileHover={{ y: -5 }}
                            className="bg-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all duration-300"
                        >
                            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mb-6">
                                <Shield className="w-6 h-6 text-green-600" />
                            </div>
                            <h3 className="text-xl font-semibold text-gray-900 mb-4">Risk Management</h3>
                            <p className="text-gray-600 leading-relaxed">
                                Built-in safeguards and circuit breakers protect your portfolio from extreme market
                                conditions and prevent concentration risk.
                            </p>
                        </motion.div>

                        <motion.div
                            whileHover={{ y: -5 }}
                            className="bg-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all duration-300"
                        >
                            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center mb-6">
                                <Zap className="w-6 h-6 text-purple-600" />
                            </div>
                            <h3 className="text-xl font-semibold text-gray-900 mb-4">Real-time Oracle Data</h3>
                            <p className="text-gray-600 leading-relaxed">
                                Powered by Reflector's decentralized price feeds for accurate, manipulation-resistant
                                pricing data from multiple sources.
                            </p>
                        </motion.div>
                    </div>
                </motion.div>
            </div>
        </div>
    )
}

export default Landing