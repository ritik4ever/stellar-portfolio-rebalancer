import React from 'react'
import { StellarNetwork } from '../utils/networkDetection'

interface NetworkMismatchBannerProps {
  configuredNetwork: StellarNetwork
  walletNetwork: StellarNetwork | null
  onDismiss?: () => void
}

const NETWORK_LABELS: Record<StellarNetwork, string> = {
  testnet: 'Testnet',
  mainnet: 'Mainnet (Public)',
  standalone: 'Standalone / Sandbox',
  futurenet: 'Futurenet',
  unknown: 'Unknown',
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
  onDismiss,
}) => {
  const guide = NETWORK_GUIDE[configuredNetwork] ?? NETWORK_GUIDE.unknown
  const configuredLabel = NETWORK_LABELS[configuredNetwork] ?? configuredNetwork
  const walletLabel = walletNetwork ? NETWORK_LABELS[walletNetwork] ?? walletNetwork : 'Unknown'

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
          <p className="text-sm text-amber-700 dark:text-amber-400 mt-2">
            {guide.detail}
          </p>
          <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
            Transactions will fail until the network is switched.
          </p>
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
