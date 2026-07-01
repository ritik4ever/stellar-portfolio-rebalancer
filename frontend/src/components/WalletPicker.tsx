import React, { useState, useEffect } from 'react'
import { walletManager } from '../utils/walletManager'
import { SUPPORTED_WALLETS, WalletInfo, getLastUsedWallet, setLastUsedWallet } from '../lib/wallet'

interface WalletPickerProps {
  onConnect: (publicKey: string, walletType: string) => void
  onError: (error: string) => void
  onDisconnect?: () => void
}

export const WalletPicker: React.FC<WalletPickerProps> = ({ onConnect, onError, onDisconnect }) => {
  const [connecting, setConnecting] = useState<string | null>(null)
  const [lastUsed, setLastUsed] = useState<string | null>(getLastUsedWallet())
  const [connectedWallet, setConnectedWallet] = useState<string | null>(null)

  useEffect(() => {
    // Check if already connected
    const currentType = walletManager.getWalletType()
    if (currentType) {
      setConnectedWallet(currentType)
    }
  }, [])

  const detectInstalled = (walletType: string): boolean => {
    if (typeof window === 'undefined') return false
    switch (walletType) {
      case 'freighter': return !!window.freighter
      case 'rabet': return !!window.rabet
      case 'xbull': return !!window.xBull
      case 'lobstr': return false // LOBSTR is usually mobile or extension
      case 'walletconnect': return false // Requires QR flow
      default: return false
    }
  }

  const handleConnect = async (wallet: WalletInfo) => {
    setConnecting(wallet.type)

    try {
      // Disconnect previous if switching
      if (connectedWallet && connectedWallet !== wallet.type) {
        await walletManager.disconnect()
        if (onDisconnect) onDisconnect()
      }

      // Use the underlying walletManager for uniform interface
      const publicKey = await walletManager.connect(wallet.type as any)

      setLastUsedWallet(wallet.type)
      setLastUsed(wallet.type)
      setConnectedWallet(wallet.type)

      onConnect(publicKey, wallet.name)
    } catch (error: any) {
      let msg = error.message || 'Failed to connect wallet'
      if (error.code === 'WALLET_NOT_INSTALLED') {
        msg = `${wallet.name} is not installed. `
      }
      onError(msg)
    } finally {
      setConnecting(null)
    }
  }

  return (
    <div className="wallet-picker space-y-2 p-4 border rounded-lg bg-white dark:bg-gray-900">
      <h3 className="font-semibold mb-3">Connect Wallet</h3>

      {SUPPORTED_WALLETS.map((wallet) => {
        const isInstalled = detectInstalled(wallet.type)
        const isLastUsed = lastUsed === wallet.type
        const isConnected = connectedWallet === wallet.type

        return (
          <button
            key={wallet.type}
            onClick={() => handleConnect(wallet)}
            disabled={connecting === wallet.type}
            className={`w-full flex justify-between items-center p-3 rounded border transition-all
              ${isInstalled ? 'border-green-500 hover:bg-green-50' : 'border-gray-300'}
              ${isConnected ? 'bg-green-100 border-green-600' : ''}
              disabled:opacity-60`}
          >
            <div className="flex items-center gap-3">
              <span className="font-medium">{wallet.name}</span>
              {isLastUsed && <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded">Last used</span>}
              {isConnected && <span className="text-xs px-2 py-0.5 bg-green-200 text-green-800 rounded">Connected</span>}
            </div>

            <div className="flex items-center gap-2 text-sm">
              {isInstalled ? (
                <span className="text-green-600">Installed</span>
              ) : (
                <a
                  href={wallet.installUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-blue-600 hover:underline"
                >
                  Install
                </a>
              )}
              {connecting === wallet.type && <span className="text-xs">Connecting...</span>}
            </div>
          </button>
        )
      })}

      <p className="text-xs text-gray-500 mt-3">Last used wallet is stored in localStorage for quick reconnect.</p>
    </div>
  )
}

export default WalletPicker
