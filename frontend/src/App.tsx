import { useState, useEffect } from 'react'
import Landing from './components/Landing'
import Dashboard from './components/Dashboard'
import PortfolioSetup from './components/PortfolioSetup'
import { StellarWallet } from './utils/stellar'

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
            const savedKey = localStorage.getItem('stellar_public_key')
            const walletConnected = localStorage.getItem('wallet_connected')

            if (savedKey && walletConnected) {
                setPublicKey(savedKey)
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
            const publicKey = await StellarWallet.connectWallet()
            setPublicKey(publicKey)
            setCurrentView('dashboard')
        } catch (error: any) {
            console.error('Wallet connection error:', error)

            if (error.message === 'NO_WALLET_FOUND') {
                setError('No Stellar wallet detected. Please install Freighter, Rabet, or another Stellar wallet.')
            } else if (error.message?.includes('declined') || error.message?.includes('rejected')) {
                setError('Wallet connection was declined. Please try again and approve the connection.')
            } else {
                setError('Failed to connect wallet. Please refresh the page and try again.')
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