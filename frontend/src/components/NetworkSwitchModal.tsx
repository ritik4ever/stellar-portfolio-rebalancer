import React, { useRef } from 'react'
import { StellarNetwork, networkLabel } from '../utils/networkDetection'
import { useDialogFocus } from '../hooks/useDialogFocus'

interface NetworkSwitchModalProps {
  pendingNetwork: StellarNetwork
  currentNetwork: StellarNetwork
  /** The one network this app accepts. When known, the dialog states it exactly. */
  configuredNetwork?: StellarNetwork
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Asks the user to confirm or reject a network change made in their wallet.
 *
 * Keyboard contract: focus starts on the non-destructive "Cancel Switch"
 * (so an accidental Enter never moves a user towards Mainnet), Tab and
 * Shift+Tab stay inside the dialog, and Escape rejects the switch. Each
 * button is described by the exact outcome of choosing it.
 */
export const NetworkSwitchModal: React.FC<NetworkSwitchModalProps> = ({
  pendingNetwork,
  currentNetwork,
  configuredNetwork,
  onConfirm,
  onCancel,
}) => {
  const isSwitchingToMainnet = pendingNetwork === 'mainnet'
  const current = networkLabel(currentNetwork)
  const pending = networkLabel(pendingNetwork)
  const configured = configuredNetwork && configuredNetwork !== 'unknown' ? networkLabel(configuredNetwork) : null
  const pendingMatchesApp = configuredNetwork === pendingNetwork

  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useDialogFocus(true, dialogRef, { onClose: onCancel, initialFocusRef: cancelRef })

  const describedBy = [
    'network-switch-summary',
    configured ? 'network-switch-allowed' : null,
    isSwitchingToMainnet ? 'network-switch-warning' : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        <h2 id="modal-title" className="text-xl font-bold text-slate-900 dark:text-white">
          Network Switch Detected
        </h2>

        <p id="network-switch-summary" className="mt-4 text-sm text-slate-600 dark:text-slate-300">
          Your wallet has switched from <strong>{current}</strong> to <strong>{pending}</strong>.
        </p>

        {configured && (
          <p id="network-switch-allowed" className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            This app is set to <strong>{configured}</strong>.{' '}
            {pendingMatchesApp
              ? 'Your wallet now matches it.'
              : `Transactions will fail while your wallet is on ${pending}; only ${configured} is accepted.`}
          </p>
        )}

        {isSwitchingToMainnet && (
          <div
            id="network-switch-warning"
            className="mt-4 rounded-lg bg-red-50 p-4 border border-red-200 dark:bg-red-950/30 dark:border-red-900"
          >
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">
              <span aria-hidden>⚠️ </span>Warning: Real Funds Implication
            </p>
            <p className="mt-1 text-sm text-red-700 dark:text-red-400">
              You are switching to the Mainnet. Any transactions approved on this network will use real funds and are irreversible.
            </p>
          </div>
        )}

        <p className="mt-4 text-sm font-medium text-slate-700 dark:text-slate-200">
          Choose what the app should do. Press Escape to cancel the switch.
        </p>

        <div className="mt-3 flex flex-col-reverse gap-4 sm:flex-row sm:justify-end">
          <div className="flex flex-1 flex-col gap-1">
            <button
              ref={cancelRef}
              type="button"
              onClick={onCancel}
              aria-describedby="network-switch-cancel-outcome"
              className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel Switch
            </button>
            <p id="network-switch-cancel-outcome" className="text-xs text-slate-500 dark:text-slate-400">
              The app keeps treating your wallet as being on {current}. Your wallet itself stays on {pending}, and you
              won&apos;t be asked about {pending} again.
            </p>
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <button
              type="button"
              onClick={onConfirm}
              aria-describedby="network-switch-confirm-outcome"
              className={`w-full rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors ${
                isSwitchingToMainnet ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              Proceed to {pending}
            </button>
            <p id="network-switch-confirm-outcome" className="text-xs text-slate-500 dark:text-slate-400">
              The app treats your wallet as being on {pending} and reloads your data.
              {configured && !pendingMatchesApp
                ? ` Transactions will fail until your wallet is back on ${configured}.`
                : ''}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
