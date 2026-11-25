import React, { useState, useEffect, useRef } from 'react'
import { walletManager } from '../utils/walletManager'
import { WalletAdapter } from '../utils/walletAdapters'
import { getConfiguredNetwork, detectWalletNetwork, networkLabel } from '../utils/networkDetection'
import { NetworkMismatchBanner } from './NetworkMismatchBanner'
import { runBootDiagnostics, type BootCheck } from '../app/walletBoot'
import BootDiagnosticsPanel from './BootDiagnosticsPanel'
import { api, ENDPOINTS } from '../config/api'

interface WalletSelectorProps {
    onConnect: (publicKey: string) => void
    onError?: (error: string) => void
}

interface NetworkMismatchState {
    configured: string
    detected: string
    walletType: string
}

export const WalletSelector: React.FC<WalletSelectorProps> = ({ onConnect, onError }) => {
    const [connecting, setConnecting] = useState<string | null>(null)
    const [availableWallets, setAvailableWallets] = useState<WalletAdapter[]>([])
    const [bootChecks, setBootChecks] = useState<BootCheck[]>([])
    const [showDiagnostics, setShowDiagnostics] = useState(false)
    const [autoReconnect, setAutoReconnect] = useState<boolean>(walletManager.getAutoReconnect())
    const [networkMismatch, setNetworkMismatch] = useState<NetworkMismatchState | null>(null)
    const [status, setStatus] = useState('')
    const [errorMessage, setErrorMessage] = useState('')
    const [errorWallet, setErrorWallet] = useState<string | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
    const mountedRef = useRef(true)
    const connectingRef = useRef(false)
    const emptyStateRef = useRef<HTMLDivElement>(null)
    // Only move focus to the first wallet when the selector itself owns focus (first
    // render, or the user was on "Check again"); a late detection must never steal
    // focus from something the user is typing in elsewhere on the page.
    const autoFocusRef = useRef(true)
    const availableCountRef = useRef(0)

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
        }
    }, [])

    /**
     * Re-reads which wallet extensions are present. Extensions inject themselves
     * after page load and can be installed, enabled or unlocked while this is open,
     * so a single read at mount is not enough. This never reloads the page, so
     * nothing else the user has open is lost, and it is idempotent: repeating it
     * cannot duplicate a connection.
     */
    const refreshWallets = (reason: 'manual' | 'auto') => {
        const wallets = walletManager.getAvailableWallets()
        const hadWallets = availableCountRef.current > 0
        if (wallets.length > 0 && !hadWallets) {
            autoFocusRef.current = emptyStateRef.current?.contains(document.activeElement) ?? false
            setStatus(`${wallets.map(w => w.name).join(', ')} detected. Select a wallet to connect.`)
        } else if (wallets.length === 0 && reason === 'manual') {
            setStatus(
                'Still no wallet found. Make sure the extension is installed, enabled and unlocked, then select Check again.',
            )
        }
        availableCountRef.current = wallets.length
        setAvailableWallets(wallets)
        if (reason === 'manual') runChecks()
    }

    useEffect(() => {
        const wallets = walletManager.getAvailableWallets()
        availableCountRef.current = wallets.length
        setAvailableWallets(wallets)
        runChecks()
        if (wallets.length > 0) return
        // Extensions often inject a moment after load, and the user may return from
        // installing one: poll briefly, and re-check when the window regains focus.
        let tries = 0
        const timer = window.setInterval(() => {
            tries += 1
            refreshWallets('auto')
            if (availableCountRef.current > 0 || tries >= 10) window.clearInterval(timer)
        }, 500)
        const onFocus = () => {
            if (availableCountRef.current === 0) refreshWallets('auto')
        }
        window.addEventListener('focus', onFocus)
        return () => {
            window.clearInterval(timer)
            window.removeEventListener('focus', onFocus)
        }
    }, [])

    useEffect(() => {
        if (availableWallets.length > 0 && containerRef.current && autoFocusRef.current) {
            const firstButton = containerRef.current.querySelector<HTMLButtonElement>('button')
            firstButton?.focus()
        }
    }, [availableWallets])

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

    // `inline: false` is for the mismatch case, where NetworkMismatchBanner (itself an
    // alert) already states the allowed network: announcing it twice would be noise.
    const fail = (walletType: string, message: string, inline = true) => {
        setStatus('')
        setErrorMessage(inline ? message : '')
        setErrorWallet(walletType)
        onError?.(message)
        // Keep focus on the control the user pressed so the error read out next
        // to it is where they are, instead of dropping to <body>.
        setTimeout(() => buttonRefs.current[walletType]?.focus(), 0)
    }

    const handleConnect = async (walletType: string) => {
        // One activation path and no re-entry: a second press while a request is
        // pending must not start another wallet prompt.
        if (connectingRef.current) return
        setNetworkMismatch(null)
        setErrorMessage('')
        setErrorWallet(null)
        const configuredNetwork = getConfiguredNetwork()
        const walletName = availableWallets.find(w => w.type === walletType)?.name ?? 'your wallet'

        const detected = await detectWalletNetwork(walletType)
        if (detected && configuredNetwork !== 'unknown' && detected !== configuredNetwork) {
            setNetworkMismatch({
                configured: configuredNetwork,
                detected,
                walletType,
            })
            fail(
                walletType,
                `Wallet is on ${networkLabel(detected)}, but this app only accepts ${networkLabel(configuredNetwork)}. Switch your wallet to ${networkLabel(configuredNetwork)} and select it again.`,
                false,
            )
            return
        }

        connectingRef.current = true
        setConnecting(walletType)
        setStatus(`Connecting to ${walletName}. Approve the request in your wallet.`)
        try {
            const publicKey = await walletManager.connect(walletType as any)
            if (!mountedRef.current) {
                // The dialog was closed while the wallet prompt was open: the user
                // abandoned this, so don't sign them in behind their back.
                try {
                    await walletManager.disconnect()
                } catch {
                    /* nothing to clean up */
                }
                return
            }
            setStatus(`Connected to ${walletName}.`)
            onConnect(publicKey)
        } catch (error: any) {
            if (!mountedRef.current) return
            const allowed = configuredNetwork !== 'unknown' ? networkLabel(configuredNetwork) : null
            let message = 'Connection failed'
            if (error.code === 'USER_DECLINED') {
                message = 'Connection was declined in your wallet, so nothing was connected. Select a wallet to try again.'
            } else if (error.code === 'WALLET_NOT_INSTALLED') {
                message = `${walletName} is not available. Make sure the extension is installed, enabled and unlocked, then select it again. There is no need to reload the page.`
                // The extension may have gone away since the list was built.
                autoFocusRef.current = false
                setTimeout(() => mountedRef.current && refreshWallets('auto'), 0)
            } else if (error.code === 'NETWORK_MISMATCH') {
                message = allowed
                    ? `Your wallet is on a different network. This app only accepts ${allowed}: switch your wallet to ${allowed}, then select it again.`
                    : 'Network mismatch. Please check your wallet network settings.'
            } else if (error.code === 'TIMEOUT') {
                message = 'Connection timed out before your wallet responded, so nothing was connected. Select a wallet to try again.'
            } else if (error.message && error.message.includes('popup')) {
                message = 'Popup was blocked by your browser. Please allow popups for this site and try again.'
            } else if (error.message) {
                message = error.message
            }
            fail(walletType, message)
        } finally {
            connectingRef.current = false
            if (mountedRef.current) setConnecting(null)
        }
    }

    const toggleAutoReconnect = () => {
        const next = !autoReconnect
        setAutoReconnect(next)
        walletManager.setAutoReconnect(next)
    }

    if (availableWallets.length === 0) {
        return (
            <div ref={emptyStateRef}>
                <div className="p-4 border rounded-lg bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800" role="alert">
                    <p className="text-yellow-800 dark:text-yellow-300 text-sm">
                        No Stellar wallets detected. Please install Freighter, Rabet, xBull, or Hana wallet extension.
                    </p>
                    <p className="mt-2 text-yellow-800 dark:text-yellow-300 text-sm">
                        Already installed? Enable and unlock it, then check again. You don&apos;t need to reload the page.
                    </p>
                    <button
                        type="button"
                        onClick={() => refreshWallets('manual')}
                        className="mt-3 rounded-md bg-yellow-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-yellow-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-600 focus-visible:ring-offset-2"
                    >
                        Check again
                    </button>
                </div>
                <p role="status" aria-live="polite" className="sr-only" data-testid="wallet-connect-status">
                    {status}
                </p>
                <div className="mt-3 border-t border-gray-100 dark:border-gray-700 pt-3">
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

    return (
        <div className="space-y-3" ref={containerRef} role="group" aria-label="Available wallets">
            {networkMismatch && (
                <div id="wallet-network-mismatch">
                <NetworkMismatchBanner
                    configuredNetwork={networkMismatch.configured as any}
                    walletNetwork={networkMismatch.detected as any}
                    walletType={networkMismatch.walletType}
                    onDismiss={() => setNetworkMismatch(null)}
                />
                </div>
            )}
            <p className="text-sm text-gray-600 dark:text-gray-400" id="wallet-selector-label">
                Select a wallet to connect
            </p>
            <p role="status" aria-live="polite" className="sr-only" data-testid="wallet-connect-status">
                {status}
            </p>
            {errorMessage && (
                <p
                    id="wallet-connect-error"
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                >
                    {errorMessage}
                </p>
            )}
            {availableWallets.map((wallet) => (
                <button
                    key={wallet.type}
                    ref={(el) => {
                        buttonRefs.current[wallet.type] = el
                    }}
                    type="button"
                    onClick={() => handleConnect(wallet.type)}
                    // aria-disabled (not disabled) keeps focus on the pressed button
                    aria-disabled={connecting !== null ? true : undefined}
                    aria-describedby={
                        errorWallet === wallet.type
                            ? errorMessage
                                ? 'wallet-connect-error'
                                : networkMismatch
                                  ? 'wallet-network-mismatch'
                                  : undefined
                            : connecting === wallet.type
                              ? 'connecting-description'
                              : undefined
                    }
                    aria-label={`Connect to ${wallet.name}`}
                    className="wallet-selector-btn w-full flex items-center justify-between p-4 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed transition-colors dark:text-gray-200"
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
