import { useState, useEffect } from 'react'
import Landing from './components/Landing'
import Dashboard from './components/Dashboard'
import PortfolioSetup from './components/PortfolioSetup'
import { walletManager } from './utils/walletManager'
import { WalletError } from './utils/walletAdapters'
import { login as authLogin } from './services/authService'

function App() {
    const [currentView, setCurrentView] = useState('landing')
    const [publicKey, setPublicKey] = useState<string | null>(null)
    const [isConnecting, setIsConnecting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        checkWalletConnection()
    }, [])

    const checkWalletConnection = async () => {
        try {
            const publicKey = await walletManager.reconnect()
            if (publicKey) {
                try {
                    await authLogin(publicKey)
                } catch (_) {
                }
                setPublicKey(publicKey)
                setCurrentView('dashboard')
            }
        } catch (error) {
            console.error('Error checking wallet connection:', error)
        }
    }

    const connectWallet = async () => {
        setIsConnecting(true)
        setError(null)

        try {
            const publicKey = walletManager.getPublicKey()
            if (publicKey) {
                try {
                    await authLogin(publicKey)
                } catch (_) {
                }
                setPublicKey(publicKey)
                setCurrentView('dashboard')
            } else {
                setError('No wallet connected. Please select a wallet first.')
            }
        } catch (error: any) {
            console.error('Wallet connection error:', error)

            if (error instanceof WalletError) {
                if (error.code === 'USER_DECLINED') {
                    setError('Connection was declined. Please approve in your wallet.')
                } else if (error.code === 'WALLET_NOT_INSTALLED') {
                    setError(`${error.walletType || 'Wallet'} is not installed. Please install it and refresh.`)
                } else if (error.code === 'NETWORK_MISMATCH') {
                    setError('Network mismatch. Please check your wallet network settings.')
                } else if (error.code === 'TIMEOUT') {
                    setError('Connection timed out. Please try again.')
                } else {
                    setError(error.message || 'Failed to connect wallet.')
                }
            } else if (error.message === 'NO_WALLET_FOUND') {
                setError('No Stellar wallet detected. Please install Freighter, Rabet, or xBull wallet.')
            } else {
                setError(error.message || 'Failed to connect wallet. Please try again.')
            }
        } finally {
            setIsConnecting(false)
        }
    }

    const handleNavigate = (view: string) => {
        setError(null)
        setCurrentView(view)
    }

    return (
        <div className="App">
            {error && (
                <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-50 dark:bg-red-900/40 border border-red-200 dark:border-red-800 rounded-lg p-4 max-w-md">
                    <div className="flex items-center text-red-800 dark:text-red-300">
                        <span className="mr-2">⚠️</span>
                        <span>{error}</span>
                        <button
                            onClick={() => setError(null)}
                            className="ml-4 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200"
                        >
                            ✕
                        </button>
                    </div>
                </div>
            )}

            {currentView === 'landing' && (
                <Landing
                    onNavigate={handleNavigate}
                    onConnectWallet={connectWallet}
                    isConnecting={isConnecting}
                    publicKey={publicKey}
                />
            )}

            {currentView === 'dashboard' && (
                <Dashboard
                    onNavigate={handleNavigate}
                    publicKey={publicKey}
                />
            )}

            {currentView === 'setup' && (
                <PortfolioSetup
                    onNavigate={handleNavigate}
                    publicKey={publicKey}
                />
            )}
        </div>
    )
}

export default App