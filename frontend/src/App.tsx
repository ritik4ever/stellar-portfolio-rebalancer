import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Landing from './components/Landing'
import Dashboard from './components/Dashboard'
import PortfolioSetup from './components/PortfolioSetup'
import Legal from './components/Legal'
import ConsentGate from './components/ConsentGate'
import { walletManager } from './utils/walletManager'
import { WalletError } from './utils/walletAdapters'
import { login as authLogin } from './services/authService'
import {
    isAuthServiceUnavailable,
    resolveConsentAcceptedNavigation,
    runWalletReconnectBoot,
    runBootDiagnostics,
    type BootCheck,
} from './app/walletBoot'
import BootDiagnosticsPanel from './components/BootDiagnosticsPanel'
import { api, ENDPOINTS } from './config/api'
import type { LegalDocType } from './components/Legal'
import RealtimeStatusBanner from './components/RealtimeStatusBanner'
import BackendCapabilitiesBanner from './components/BackendCapabilitiesBanner'
import StartupSplash from './components/StartupSplash'
import { useReadinessReport } from './hooks/useReadinessReport'
import {
    onAuthSessionExpired,
    onAuthSessionRestored,
} from './services/authService'
import DeveloperDrawer from './components/DeveloperDrawer'
import { checkApiCompatibility, type ApiCompatibilityResult } from './config/apiCompatibility'

function App() {
    const queryClient = useQueryClient()
    const [currentView, setCurrentView] = useState('landing')
    const [publicKey, setPublicKey] = useState<string | null>(null)
    const [pendingConsentPublicKey, setPendingConsentPublicKey] = useState<string | null>(null)
    const [legalDoc, setLegalDoc] = useState<LegalDocType | null>(null)
    const [isConnecting, setIsConnecting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [sessionRecovery, setSessionRecovery] = useState<string | null>(null)
    const [sessionRecoverySource, setSessionRecoverySource] = useState<string | null>(null)
    const [isRecoveringSession, setIsRecoveringSession] = useState(false)

    const showBackendBanner = loadError || notices.length > 0
    const showApiCompatibilityBanner =
        !apiCompatibilityDismissed &&
        apiCompatibility !== null &&
        apiCompatibility.severity !== 'ok'
    const contentTopPad =
        showBackendBanner && showApiCompatibilityBanner
            ? 'pt-28'
            : showBackendBanner || showApiCompatibilityBanner
              ? 'pt-14'
              : 'pt-4'

    const [bootChecks, setBootChecks] = useState<BootCheck[]>([])
    const [showBootDiagnostics, setShowBootDiagnostics] = useState(false)

    useEffect(() => {
        checkWalletConnection()
        runBootDiagnostics({
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
        }).then((result) => setBootChecks(result.checks))
    }, [])

    useEffect(() => {
        const controller = new AbortController()
        setApiCompatibilityLoading(true)
        void checkApiCompatibility(controller.signal).then((result) => {
            setApiCompatibility(result)
            setApiCompatibilityLoading(false)
        })
        return () => controller.abort()
    }, [])

    useEffect(() => {
        const clearRecovery = () => {
            setSessionRecovery(null)
            setSessionRecoverySource(null)
        }

        const unsubscribeExpired = onAuthSessionExpired((detail) => {
            setSessionRecovery(detail.message)
            setSessionRecoverySource(detail.source ?? null)
            setError(null)
        })
        const unsubscribeRestored = onAuthSessionRestored(() => {
            clearRecovery()
        })

        return () => {
            unsubscribeExpired()
            unsubscribeRestored()
        }
    }, [])

    const checkConsent = async (userId: string): Promise<boolean> => {
        try {
            const res = await api.get<{ accepted: boolean }>(
                `${ENDPOINTS.CONSENT_STATUS}?userId=${encodeURIComponent(userId)}`
            )
            return !!res?.accepted
        } catch {
            return false
        }
    }

    const applyAuthenticatedWallet = async (pk: string, navigateToDashboard: boolean) => {
        setIsConnecting(true)
        setError(null)
        try {
            try {
                await authLogin(pk)
            } catch (authErr: unknown) {
                if (isAuthServiceUnavailable(authErr)) {
                    // Auth service not configured – soft fail, allow access.
                    console.warn('Auth service unavailable during connect; proceeding without JWT:', authErr)
                } else {
                    // Hard auth failure: wallet is connected but the backend rejected
                    // authentication. Do NOT navigate to the dashboard.
                    console.error('Auth login failed during wallet connect:', authErr)
                    setError(
                        'Wallet connected but authentication failed. ' +
                        'Please try reconnecting your wallet.'
                    )
                    return false
                }
            }

            setPublicKey(pk)
            if (navigateToDashboard) {
                setCurrentView('dashboard')
            }
            await queryClient.invalidateQueries()
            return true
        } finally {
            setIsConnecting(false)
        }
    }

    const checkWalletConnection = async () => {
        const result = await runWalletReconnectBoot({
            reconnect: () => walletManager.reconnect(),
            checkConsent,
            authLogin,
        })

        if (result.outcome === 'no_wallet') {
            return
        }
        if (result.outcome === 'needs_consent') {
            setPublicKey(result.publicKey)
            setPendingConsentPublicKey(result.publicKey)
            return
        }
        if (result.outcome === 'dashboard') {
            setPublicKey(result.publicKey)
            setCurrentView('dashboard')
            return
        }
        if (result.outcome === 'auth_failed') {
            setError(result.message)
            return
        }
        if (result.outcome === 'reconnect_failed') {
            setError(result.message)
        }
    }

    const connectWallet = async () => {
        try {
            const pk = walletManager.getPublicKey()
            if (pk) {
                await applyAuthenticatedWallet(pk, true)
            } else {
                setError('No wallet connected. Please select a wallet first.')
            }
        } catch (err: any) {
            console.error('Wallet connection error:', err)
            if (err instanceof WalletError) {
                if (err.code === 'USER_DECLINED') setError('Connection was declined. Please approve in your wallet.')
                else if (err.code === 'WALLET_NOT_INSTALLED') setError(`${err.walletType || 'Wallet'} is not installed. Please install it and refresh.`)
                else if (err.code === 'NETWORK_MISMATCH') setError('Network mismatch. Please check your wallet network settings.')
                else if (err.code === 'TIMEOUT') setError('Connection timed out. Please try again.')
                else setError(err.message || 'Failed to connect wallet.')
            } else if (err.message === 'NO_WALLET_FOUND') {
                setError('No Stellar wallet detected. Please install Freighter, Rabet, or xBull wallet.')
            } else {
                setError(err.message || 'Failed to connect wallet. Please try again.')
            }
        }
    }

    const retrySessionSignIn = async () => {
        const pk = walletManager.getPublicKey() || publicKey
        if (!pk) {
            setSessionRecovery('No wallet is currently connected. Reconnect your wallet first.')
            return
        }

        setIsRecoveringSession(true)
        try {
            const success = await applyAuthenticatedWallet(pk, false)
            if (success) {
                setSessionRecovery(null)
                setSessionRecoverySource(null)
            }
        } finally {
            setIsRecoveringSession(false)
        }
    }

    const handleNeedsConsent = (pk: string) => {
        setPendingConsentPublicKey(pk)
    }

    const handleConsentAccepted = () => {
        const next = resolveConsentAcceptedNavigation(pendingConsentPublicKey)
        if (next) {
            setPublicKey(next.publicKey)
            setPendingConsentPublicKey(null)
            setCurrentView(next.targetView)
        }
    }

    const handleNavigate = (view: string, legalDocType?: LegalDocType) => {
        setError(null)
        if (legalDocType) setLegalDoc(legalDocType)
        else if (view.startsWith('legal-')) setLegalDoc(view.replace('legal-', '') as LegalDocType)
        else setLegalDoc(null)
        setCurrentView(view)
    }

    const errorTop = showBackendBanner ? 'top-[4.25rem]' : 'top-4'

    if (!bootReady) {
        return <StartupSplash loading={readinessLoading} loadError={loadError} />
    }

    return (
        <div className={`App min-h-screen ${contentTopPad}`}>
            <RealtimeStatusBanner />
            <BackendCapabilitiesBanner
                notices={notices}
                loadError={loadError}
                loading={readinessLoading}
                belowRealtimeBar={false}
            />
            {showApiCompatibilityBanner && apiCompatibility ? (
                <div
                    className={`fixed left-0 right-0 z-40 border-b px-4 py-3 text-sm ${
                        showBackendBanner ? 'top-14' : 'top-0'
                    } ${
                        apiCompatibility.severity === 'error'
                            ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/80 dark:text-red-100'
                            : 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/80 dark:text-amber-100'
                    }`}
                    role="alert"
                >
                    <div className="mx-auto flex max-w-7xl items-start justify-between gap-4">
                        <div>
                            <p className="font-semibold">{apiCompatibility.title}</p>
                            <p className="mt-1 opacity-90">{apiCompatibility.message}</p>
                            <p className="mt-1 text-xs opacity-75">
                                Target: {apiCompatibility.configuredOrigin}
                                {apiCompatibility.configuredApiRoot}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setApiCompatibilityDismissed(true)}
                            className="shrink-0 rounded px-2 py-1 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10"
                        >
                            Dismiss
                        </button>
                    </div>
                </div>
            ) : null}
            {apiCompatibilityLoading && !apiCompatibility ? (
                <span className="sr-only" role="status">
                    Checking API configuration
                </span>
            ) : null}
            <DeveloperDrawer publicKey={publicKey} />
            {sessionRecovery ? (
                <div
                    className="fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950 shadow-xl dark:border-amber-900 dark:bg-amber-950/80 dark:text-amber-50"
                    role="status"
                    aria-live="polite"
                >
                    <div className="flex items-start gap-3">
                        <div className="mt-0.5 text-lg">⚠️</div>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold">Session expired</p>
                            <p className="mt-1 text-sm leading-5 opacity-90">{sessionRecovery}</p>
                            {sessionRecoverySource ? (
                                <p className="mt-1 text-[11px] uppercase tracking-[0.2em] opacity-70">
                                    Source: {sessionRecoverySource}
                                </p>
                            ) : null}
                            <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={retrySessionSignIn}
                                    disabled={isRecoveringSession}
                                    className="rounded-full bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isRecoveringSession ? 'Reconnecting…' : 'Retry sign-in'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSessionRecovery(null)
                                        setSessionRecoverySource(null)
                                    }}
                                    className="rounded-full border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-100 dark:hover:bg-amber-900/40"
                                >
                                    Dismiss
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
            {error && (
                <div
                    className={`fixed left-1/2 transform -translate-x-1/2 z-50 bg-red-50 dark:bg-red-900/40 border border-red-200 dark:border-red-800 rounded-lg p-4 max-w-md ${errorTop}`}
                >
                    <div className="flex items-center text-red-800 dark:text-red-300">
                        <span className="mr-2">⚠️</span>
                        <span>{error}</span>
                        <button
                            onClick={() => setError(null)}
                            className="ml-4 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200"
                        >
                            ✕
                        </button>
                    </div>
                </div>
            )}

            {pendingConsentPublicKey ? (
                legalDoc ? (
                    <Legal doc={legalDoc} onBack={() => setLegalDoc(null)} />
                ) : (
                    <ConsentGate
                        userId={pendingConsentPublicKey}
                        onAccept={handleConsentAccepted}
                        onOpenLegal={(doc) => setLegalDoc(doc)}
                    />
                )
            ) : (currentView === 'legal-terms' || currentView === 'legal-privacy' || currentView === 'legal-cookies') && legalDoc ? (
                <Legal
                    doc={legalDoc}
                    onBack={() => handleNavigate('landing')}
                />
            ) : currentView === 'landing' ? (
                <div className="relative">
                    <Landing
                        onNavigate={handleNavigate}
                        onConnectWallet={connectWallet}
                        onNeedsConsent={handleNeedsConsent}
                        isConnecting={isConnecting}
                        publicKey={publicKey}
                    />
                    {!publicKey ? (
                        <div className="fixed bottom-4 left-4 z-40 max-w-xs">
                            <button
                                type="button"
                                onClick={() => setShowBootDiagnostics(!showBootDiagnostics)}
                                className="mb-1 flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/90 px-3 py-1.5 text-xs text-slate-500 shadow-sm backdrop-blur hover:bg-white hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                            >
                                {showBootDiagnostics ? 'Hide' : 'Show'} startup checks
                            </button>
                            {showBootDiagnostics ? (
                                <BootDiagnosticsPanel
                                    checks={bootChecks}
                                    onRetry={() => {
                                        setBootChecks([
                                            { id: 'wallet-detection', label: 'Wallet extension', status: 'loading' },
                                            { id: 'api-reachability', label: 'API reachability', status: 'loading' },
                                        ])
                                        runBootDiagnostics({
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
                                        }).then((result) => setBootChecks(result.checks))
                                    }}
                                />
                            ) : null}
                        </div>
                    ) : null}
                </div>
            ) : currentView === 'dashboard' ? (
                <Dashboard
                    onNavigate={handleNavigate}
                    publicKey={publicKey}
                />
            ) : currentView === 'setup' ? (
                <PortfolioSetup
                    onNavigate={handleNavigate}
                    publicKey={publicKey}
                />
            ) : null}
        </div>
    )
}

export default App
