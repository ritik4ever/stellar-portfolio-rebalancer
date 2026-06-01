import React, { useState, useEffect, useRef } from 'react'
import { walletManager } from '../utils/walletManager'
import { WalletAdapter } from '../utils/walletAdapters'

interface WalletSelectorProps {
    onConnect: (publicKey: string) => void
    onError: (error: string) => void
}

export const WalletSelector: React.FC<WalletSelectorProps> = ({ onConnect, onError }) => {
    const [connecting, setConnecting] = useState<string | null>(null)
    const [availableWallets, setAvailableWallets] = useState<WalletAdapter[]>([])
    const [autoReconnect, setAutoReconnect] = useState<boolean>(walletManager.getAutoReconnect())
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const wallets = walletManager.getAvailableWallets()
        setAvailableWallets(wallets)
    }, [])

    useEffect(() => {
        if (availableWallets.length > 0 && containerRef.current) {
            const firstButton = containerRef.current.querySelector<HTMLButtonElement>('button')
            firstButton?.focus()
        }
    }, [availableWallets])

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

    const toggleAutoReconnect = () => {
        const next = !autoReconnect
        setAutoReconnect(next)
        walletManager.setAutoReconnect(next)
    }

    if (availableWallets.length === 0) {
        return (
            <div className="p-4 border rounded-lg bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800" role="alert">
                <p className="text-yellow-800 dark:text-yellow-300 text-sm">
                    No Stellar wallets detected. Please install Freighter, Rabet, or xBull wallet extension.
                </p>
            </div>
        )
    }

    return (
        <div className="space-y-3" ref={containerRef} role="group" aria-label="Available wallets">
            <p className="text-sm text-gray-600 dark:text-gray-400" id="wallet-selector-label">
                Select a wallet to connect
            </p>
            {availableWallets.map((wallet, index) => (
                <button
                    key={wallet.type}
                    onClick={() => handleConnect(wallet.type)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            handleConnect(wallet.type)
                        }
                    }}
                    disabled={connecting === wallet.type}
                    aria-describedby={connecting === wallet.type ? 'connecting-description' : undefined}
                    aria-label={`Connect to ${wallet.name}`}
                    className="wallet-selector-btn w-full flex items-center justify-between p-4 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:text-gray-200"
                >
                    <span className="font-medium">{wallet.name}</span>
                    {connecting === wallet.type && (
                        <span className="text-sm text-blue-600" id="connecting-description">Connecting...</span>
                    )}
                </button>
            ))}
            <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                <button
                    type="button"
                    role="switch"
                    aria-checked={autoReconnect}
                    aria-label="Auto-reconnect on page refresh"
                    onClick={toggleAutoReconnect}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900 ${autoReconnect ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                >
                    <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${autoReconnect ? 'translate-x-[18px]' : 'translate-x-[3px]'}`}
                    />
                </button>
                <label className="text-xs text-gray-500 dark:text-gray-400 select-none">
                    Auto-reconnect on page refresh
                </label>
            </div>
        </div>
    )
}
