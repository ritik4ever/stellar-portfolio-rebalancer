import React, { useState, useEffect } from 'react'
import { walletManager } from '../utils/walletManager'
import { WalletAdapter } from '../utils/walletAdapters'
import { runBootDiagnostics, type BootCheck } from '../app/walletBoot'
import BootDiagnosticsPanel from './BootDiagnosticsPanel'
import { api, ENDPOINTS } from '../config/api'

interface WalletSelectorProps {
    onConnect: (publicKey: string) => void
    onError: (error: string) => void
}

export const WalletSelector: React.FC<WalletSelectorProps> = ({ onConnect, onError }) => {
    const [connecting, setConnecting] = useState<string | null>(null)
    const [availableWallets, setAvailableWallets] = useState<WalletAdapter[]>([])
    const [bootChecks, setBootChecks] = useState<BootCheck[]>([])
    const [showDiagnostics, setShowDiagnostics] = useState(false)

    useEffect(() => {
        const wallets = walletManager.getAvailableWallets()
        setAvailableWallets(wallets)
        runChecks()
    }, [])

    const runChecks = async () => {
        setBootChecks([
            { id: 'wallet-detection', label: 'Wallet extension', status: 'loading' },
            { id: 'api-reachability', label: 'API reachability', status: 'loading' },
        ])
        const result = await runBootDiagnostics({
            checkWallets: () => {
                const wallets = walletManager.getAvailableWallets()
                return wallets.length > 0
            },
            checkApi: async () => {
                try {
                    await api.get(ENDPOINTS.HEALTH)
                    return true
                } catch {
                    return false
                }
            },
        })
        setBootChecks(result.checks)
    }

    const handleConnect = async (walletType: string) => {
        setConnecting(walletType)
        try {
            const publicKey = await walletManager.connect(walletType as any)
            onConnect(publicKey)
        } catch (error: any) {
            let errorMessage = 'Connection failed'
            if (error.code === 'USER_DECLINED') {
                errorMessage = 'Connection was declined. Please approve in your wallet.'
            } else if (error.code === 'WALLET_NOT_INSTALLED') {
                errorMessage = `${error.walletType || 'Wallet'} is not installed. Please install it and refresh.`
            } else if (error.code === 'NETWORK_MISMATCH') {
                errorMessage = 'Network mismatch. Please check your wallet network settings.'
            } else if (error.code === 'TIMEOUT') {
                errorMessage = 'Connection timed out. Please try again.'
            } else if (error.message) {
                errorMessage = error.message
            }
            onError(errorMessage)
        } finally {
            setConnecting(null)
        }
    }

    return (
        <div className="space-y-3">
            {availableWallets.length === 0 ? (
                <div className="p-4 border rounded-lg bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800">
                    <p className="text-yellow-800 dark:text-yellow-300 text-sm">
                        No Stellar wallets detected. Please install Freighter, Rabet, or xBull wallet extension.
                    </p>
                </div>
            ) : (
                availableWallets.map((wallet) => (
                    <button
                        key={wallet.type}
                        onClick={() => handleConnect(wallet.type)}
                        disabled={connecting === wallet.type}
                        className="w-full flex items-center justify-between p-4 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:text-gray-200"
                    >
                        <span className="font-medium">{wallet.name}</span>
                        {connecting === wallet.type && (
                            <span className="text-sm text-blue-600">Connecting...</span>
                        )}
                    </button>
                ))
            )}
            <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
                <button
                    type="button"
                    onClick={() => setShowDiagnostics(!showDiagnostics)}
                    className="flex w-full items-center justify-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                >
                    {showDiagnostics ? 'Hide' : 'Show'} startup diagnostics
                </button>
                {showDiagnostics ? (
                    <BootDiagnosticsPanel
                        checks={bootChecks}
                        onRetry={runChecks}
                        className="mt-2"
                    />
                ) : null}
            </div>
        </div>
    )
}
