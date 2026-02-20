import React, { useState, useEffect } from 'react'
import { walletManager } from '../utils/walletManager'
import { WalletAdapter } from '../utils/walletAdapters'

interface WalletSelectorProps {
    onConnect: (publicKey: string) => void
    onError: (error: string) => void
}

export const WalletSelector: React.FC<WalletSelectorProps> = ({ onConnect, onError }) => {
    const [connecting, setConnecting] = useState<string | null>(null)
    const [availableWallets, setAvailableWallets] = useState<WalletAdapter[]>([])

    useEffect(() => {
        const wallets = walletManager.getAvailableWallets()
        setAvailableWallets(wallets)
    }, [])

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

    if (availableWallets.length === 0) {
        return (
            <div className="p-4 border rounded-lg bg-yellow-50 border-yellow-200">
                <p className="text-yellow-800 text-sm">
                    No Stellar wallets detected. Please install Freighter, Rabet, or xBull wallet extension.
                </p>
            </div>
        )
    }

    return (
        <div className="space-y-3">
            {availableWallets.map((wallet) => (
                <button
                    key={wallet.type}
                    onClick={() => handleConnect(wallet.type)}
                    disabled={connecting === wallet.type}
                    className="w-full flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    <span className="font-medium">{wallet.name}</span>
                    {connecting === wallet.type && (
                        <span className="text-sm text-blue-600">Connecting...</span>
                    )}
                </button>
            ))}
        </div>
    )
}
