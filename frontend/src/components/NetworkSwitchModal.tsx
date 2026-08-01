import React from 'react'
import { StellarNetwork } from '../utils/networkDetection'

interface NetworkSwitchModalProps {
  pendingNetwork: StellarNetwork
  currentNetwork: StellarNetwork
  onConfirm: () => void
  onCancel: () => void
}

const NETWORK_LABELS: Record<StellarNetwork, string> = {
  testnet: 'Testnet',
  mainnet: 'Mainnet (Public)',
  standalone: 'Standalone / Sandbox',
  futurenet: 'Futurenet',
  unknown: 'Unknown',
}

export const NetworkSwitchModal: React.FC<NetworkSwitchModalProps> = ({
  pendingNetwork,
  currentNetwork,
  onConfirm,
  onCancel,
}) => {
  const isSwitchingToMainnet = pendingNetwork === 'mainnet'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h2 id="modal-title" className="text-xl font-bold text-slate-900 dark:text-white">
          Network Switch Detected
        </h2>
        
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
          Your wallet has switched from <strong>{NETWORK_LABELS[currentNetwork] || currentNetwork}</strong> to <strong>{NETWORK_LABELS[pendingNetwork] || pendingNetwork}</strong>.
        </p>

        {isSwitchingToMainnet && (
          <div className="mt-4 rounded-lg bg-red-50 p-4 border border-red-200 dark:bg-red-950/30 dark:border-red-900">
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">
              ⚠️ Warning: Real Funds Implication
            </p>
            <p className="mt-1 text-sm text-red-700 dark:text-red-400">
              You are switching to the Mainnet. Any transactions approved on this network will use real funds and are irreversible.
            </p>
          </div>
        )}

        <div className="mt-4 text-sm text-slate-600 dark:text-slate-300">
          Do you want to apply this network switch to the application?
        </div>

        <div className="mt-6 flex flex-col-reverse justify-end gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onCancel}
            className="w-full rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 sm:w-auto transition-colors"
          >
            Cancel Switch
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`w-full rounded-lg px-4 py-2 text-sm font-semibold text-white sm:w-auto transition-colors ${
              isSwitchingToMainnet
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            Proceed to {NETWORK_LABELS[pendingNetwork] || pendingNetwork}
          </button>
        </div>
      </div>
    </div>
  )
}
