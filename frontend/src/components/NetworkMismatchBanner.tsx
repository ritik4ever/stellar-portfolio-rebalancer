import React, { useState, useCallback } from 'react'
import { StellarNetwork, detectWalletNetwork } from '../utils/networkDetection'
import { getAdapter } from '../utils/walletAdapters'

interface NetworkMismatchBannerProps {
  configuredNetwork: StellarNetwork
  walletNetwork: StellarNetwork | null
  walletType?: string
  onDismiss?: () => void
}

const NETWORK_LABELS: Record<StellarNetwork, string> = {
  testnet: 'Testnet',
  mainnet: 'Mainnet (Public)',
  standalone: 'Standalone / Sandbox',
  futurenet: 'Futurenet',
  unknown: 'Unknown',
}

const NETWORK_PASSPHRASES: Record<StellarNetwork, string> = {
  testnet: 'Test SDF Network ; September 2015',
  mainnet: 'Public Global Stellar Network ; September 2015',
  standalone: 'Standalone Network ; February 2017',
  futurenet: 'Future Network ; October 2022',
  unknown: '',
}

const NETWORK_GUIDE: Record<string, { action: string; detail: string }> = {
  mainnet: {
    action: 'Switch your wallet to Mainnet',
    detail: 'Open your wallet extension settings and switch the network to "Mainnet" or "Public Global Stellar Network".',
  },
  testnet: {
    action: 'Switch your wallet to Testnet',
    detail: 'Open your wallet extension settings and switch the network to "Testnet" or "Test SDF Network".',
  },
  standalone: {
    action: 'Switch your wallet to Standalone',
    detail: 'Open your wallet extension and switch the network to your local Standalone network.',
  },
  futurenet: {
    action: 'Switch your wallet to Futurenet',
    detail: 'Open your wallet extension and switch to "Futurenet" mode.',
  },
  unknown: {
    action: 'Check your wallet network',
    detail: 'Open your wallet extension and verify the selected network matches the configured environment.',
  },
}

export const NetworkMismatchBanner: React.FC<NetworkMismatchBannerProps> = ({
  configuredNetwork,
  walletNetwork,
  walletType,
  onDismiss,
}) => {
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const [switchSuccess, setSwitchSuccess] = useState(false)

  const adapter = walletType ? getAdapter(walletType as any) : null
  const supportsProgrammaticSwitch = !!(adapter && 'switchNetwork' in adapter && adapter.switchNetwork)

  const guide = NETWORK_GUIDE[configuredNetwork] ?? NETWORK_GUIDE.unknown
  const configuredLabel = NETWORK_LABELS[configuredNetwork] ?? configuredNetwork
  const walletLabel = walletNetwork ? NETWORK_LABELS[walletNetwork] ?? walletNetwork : 'Unknown'

  const handleSwitchNetwork = useCallback(async () => {
    if (!adapter || !adapter.switchNetwork || !walletType) return

    setSwitching(true)
    setSwitchError(null)
    setSwitchSuccess(false)

    try {
      const passphrase = NETWORK_PASSPHRASES[configuredNetwork] || configuredNetwork
      await adapter.switchNetwork(passphrase)

      const detected = await detectWalletNetwork(walletType)
      if (detected === configuredNetwork) {
        setSwitchSuccess(true)
        if (onDismiss) {
          setTimeout(onDismiss, 500)
        }
      } else {
        setSwitchError('Network switch was applied but the wallet still shows the previous network. Please check your wallet settings.')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to switch network'
      setSwitchError(message)
    } finally {
      setSwitching(false)
    }
  }, [adapter, configuredNetwork, walletType, onDismiss])

  const configuredLabelLower = configuredLabel.toLowerCase()
  const switchLabel = configuredNetwork === 'unknown'
    ? 'Switch network'
    : `Switch to ${configuredLabelLower}`

  if (switchSuccess) return null

  return (
    <div
      className="p-4 border rounded-lg bg-amber-50 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="font-semibold text-amber-800 dark:text-amber-300">
            Wallet network mismatch
          </p>
          <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
            Your wallet is connected to <strong>{walletLabel}</strong>, but this
            application expects <strong>{configuredLabel}</strong>.
          </p>
          <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
            Transactions will fail until the network is switched.
          </p>
          {supportsProgrammaticSwitch ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={handleSwitchNetwork}
                disabled={switching}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-gray-900"
              >
                {switching ? 'Switching...' : switchLabel}
              </button>
              {switchError && (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400">{switchError}</p>
              )}
            </div>
          ) : (
            <div className="mt-3">
              <p className="text-sm text-amber-700 dark:text-amber-400 mb-1 font-medium">
                {guide.action}
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-400">
                {guide.detail}
              </p>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <a
              href="https://github.com/bytebunders/stellar-portfolio-rebalancer/docs/WALLET_TROUBLESHOOTING.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 dark:text-blue-400 underline hover:text-blue-800"
            >
              Wallet troubleshooting guide
            </a>
          </div>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 shrink-0"
            aria-label="Dismiss network mismatch warning"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
