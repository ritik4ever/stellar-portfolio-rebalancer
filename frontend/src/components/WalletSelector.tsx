import React, { useState } from 'react'

interface WalletOption {
    id: string
    name: string
    available: boolean
}

interface WalletSelectorProps {
    onConnect: (publicKey: string) => void
    onError: (error: string) => void
}

export const WalletSelector: React.FC<WalletSelectorProps> = ({ onConnect, onError }) => {
    const [connecting, setConnecting] = useState<string | null>(null)

    // Mock wallet list since the methods don't exist in StellarWallet yet
    const wallets: WalletOption[] = [
        { id: 'freighter', name: 'Freighter', available: !!window.freighter },
        { id: 'rabet', name: 'Rabet', available: !!window.rabet }
    ]

    const handleConnect = async (walletId: string) => {
        setConnecting(walletId)
        try {
            // Since StellarWallet.connectWallet doesn't take parameters yet,
            // we'll just use the existing method
            const { StellarWallet } = await import('../utils/stellar')
            const publicKey = await StellarWallet.connectWallet()
            onConnect(publicKey)
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Connection failed'
            onError(errorMessage)
        } finally {
            setConnecting(null)
        }
    }

    return (
        <div className="space-y-3">
            {wallets.map((wallet: WalletOption) => (
                <button
                    key={wallet.id}
                    onClick={() => handleConnect(wallet.id)}
                    disabled={!wallet.available || connecting === wallet.id}
                    className="w-full flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                    <span>{wallet.name}</span>
                    {!wallet.available && <span className="text-sm text-gray-500">Not installed</span>}
                    {connecting === wallet.id && <span>Connecting...</span>}
                </button>
            ))}
        </div>
    )
}