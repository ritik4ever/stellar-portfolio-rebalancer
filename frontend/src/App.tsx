import { useState, useEffect } from 'react'
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
} from './app/walletBoot'
import { api, ENDPOINTS } from './config/api'
import type { LegalDocType } from './components/Legal'
import RealtimeStatusBanner from './components/RealtimeStatusBanner'
import BackendCapabilitiesBanner from './components/BackendCapabilitiesBanner'
import { useRealtimeConnection } from './context/RealtimeConnectionContext'
import { useReadinessReport } from './hooks/useReadinessReport'

function App() {
    const [currentView, setCurrentView] = useState('landing')
    const [publicKey, setPublicKey] = useState<string | null>(null)
    const [pendingConsentPublicKey, setPendingConsentPublicKey] = useState<string | null>(null)
    const [legalDoc, setLegalDoc] = useState<LegalDocType | null>(null)
    const [isConnecting, setIsConnecting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const { state: realtimeState } = useRealtimeConnection()
    const { notices, loadError, loading: readinessLoading } = useReadinessReport()

    const showBackendBanner = loadError || notices.length > 0
    const wsDisconnected = realtimeState !== 'connected'

    let contentTopPad = ''
    if (wsDisconnected) {
        contentTopPad = showBackendBanner ? 'pt-28' : 'pt-14'
    } else if (showBackendBanner) {
        contentTopPad = 'pt-[4.5rem]'
    }

    useEffect(() => {
        checkWalletConnection()
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
        setIsConnecting(true)
        setError(null)
        try {
            const pk = walletManager.getPublicKey()
            if (pk) {
                try {
                    await authLogin(pk)
                } catch (authErr: unknown) {
                    if (isAuthServiceUnavailable(authErr)) {
                        // Auth service not configured – soft fail, allow access.
                        console.warn('Auth service unavailable during connect; proceeding without JWT:', authErr)
                    } else {
                        // Hard auth failure: wallet is connected but the backend
                        // rejected authentication.  Do NOT navigate to the dashboard.
                        console.error('Auth login failed during wallet connect:', authErr)
                        setError(
                            'Wallet connected but authentication failed. ' +
                            'Please try reconnecting your wallet.'
                        )
                        setIsConnecting(false)
                        return
                    }
                }
                setPublicKey(pk)
                setCurrentView('dashboard')
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
        } finally {
            setIsConnecting(false)
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

    const errorTop =
        realtimeState === 'connected'
            ? showBackendBanner
                ? 'top-[5.5rem]'
                : 'top-4'
            : showBackendBanner
              ? 'top-[8.5rem]'
              : 'top-[4.5rem]'

    return (
        <div className={`App min-h-screen ${contentTopPad}`}>
            <RealtimeStatusBanner />
            <BackendCapabilitiesBanner
                notices={notices}
                loadError={loadError}
                loading={readinessLoading}
                belowRealtimeBar={wsDisconnected}
            />
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
                <Landing
                    onNavigate={handleNavigate}
                    onConnectWallet={connectWallet}
                    onNeedsConsent={handleNeedsConsent}
                    isConnecting={isConnecting}
                    publicKey={publicKey}
                />
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