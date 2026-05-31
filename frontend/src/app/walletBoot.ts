import { WalletError } from '../utils/walletAdapters'

export function isAuthServiceUnavailable(err: unknown): boolean {
    const msg = String((err as { message?: string })?.message ?? '')
    return (
        msg.includes('503') ||
        msg.toLowerCase().includes('service_unavailable') ||
        msg.toLowerCase().includes('not configured')
    )
}

export type WalletReconnectBootDeps = {
    reconnect: () => Promise<string | null>
    checkConsent: (userId: string) => Promise<boolean>
    authLogin: (pk: string) => Promise<unknown>
}

export type WalletReconnectBootResult =
    | { outcome: 'no_wallet' }
    | { outcome: 'needs_consent'; publicKey: string }
    | { outcome: 'dashboard'; publicKey: string }
    | { outcome: 'auth_failed'; message: string }
    | { outcome: 'reconnect_failed'; message: string; walletErrorCode?: string }

export type WalletConnectBootState =
    | { status: 'loading' }
    | { status: 'connected'; publicKey: string }
    | { status: 'not_installed'; message: string }
    | { status: 'rejected'; message: string }
    | { status: 'failed'; message: string }

export type WalletConnectBootDeps = {
    checkExtension: () => Promise<boolean> | boolean
    connect: () => Promise<void>
    getAddress: () => Promise<string | null>
}

export async function runWalletConnectBoot(
    deps: WalletConnectBootDeps,
): Promise<WalletConnectBootState> {
    try {
        const hasExtension = await deps.checkExtension()
        if (!hasExtension) {
            return {
                status: 'not_installed',
                message: 'Wallet extension is not installed.',
            }
        }
    } catch {
        return {
            status: 'not_installed',
            message: 'Wallet extension is not installed.',
        }
    }

    try {
        await deps.connect()
    } catch (err: unknown) {
        const walletErr = err instanceof WalletError ? err : null
        if (walletErr?.code === 'USER_DECLINED') {
            return {
                status: 'rejected',
                message: 'Wallet connection was rejected by the user.',
            }
        }
        return {
            status: 'failed',
            message: 'Wallet connection failed. Please try again.',
        }
    }

    try {
        const publicKey = await deps.getAddress()
        if (!publicKey) {
            return {
                status: 'failed',
                message: 'Wallet connected but no address was returned.',
            }
        }
        return { status: 'connected', publicKey }
    } catch {
        return {
            status: 'failed',
            message: 'Unable to read wallet address after connecting.',
        }
    }
}

export async function runWalletReconnectBoot(
    deps: WalletReconnectBootDeps,
): Promise<WalletReconnectBootResult> {
    try {
        const pk = await deps.reconnect()
        if (!pk) {
            return { outcome: 'no_wallet' }
        }

        const accepted = await deps.checkConsent(pk)
        if (accepted) {
            try {
                await deps.authLogin(pk)
            } catch (authErr: unknown) {
                if (isAuthServiceUnavailable(authErr)) {
                    return { outcome: 'dashboard', publicKey: pk }
                }
                return {
                    outcome: 'auth_failed',
                    message:
                        'Wallet reconnected but authentication failed. Please reconnect your wallet to try again.',
                }
            }
            return { outcome: 'dashboard', publicKey: pk }
        }

        return { outcome: 'needs_consent', publicKey: pk }
    } catch (err: unknown) {
        if (err instanceof WalletError) {
            if (err.code === 'USER_DECLINED') {
                return {
                    outcome: 'reconnect_failed',
                    message: 'Wallet reconnect was declined. Please approve in your wallet.',
                    walletErrorCode: err.code,
                }
            }
            return {
                outcome: 'reconnect_failed',
                message: 'Failed to reconnect wallet. Please try connecting again.',
                walletErrorCode: err.code,
            }
        }
        return {
            outcome: 'reconnect_failed',
            message: 'Failed to reconnect wallet. Please try connecting again.',
        }
    }
}

export type ConsentAcceptNavigation = {
    targetView: 'dashboard'
    publicKey: string
}

export function resolveConsentAcceptedNavigation(
    pendingPublicKey: string | null,
): ConsentAcceptNavigation | null {
    if (!pendingPublicKey) return null
    return { targetView: 'dashboard', publicKey: pendingPublicKey }
}

// ─── Boot diagnostics ───────────────────────────────────────────────────

export type BootCheckStatus = 'loading' | 'passed' | 'failed'

export interface BootCheck {
    id: string
    label: string
    status: BootCheckStatus
    message?: string
}

export interface BootDiagnostics {
    checks: BootCheck[]
    allPassed: boolean
    timestamp: number
}

export type BootDiagnosticsDeps = {
    checkWallets: () => boolean | Promise<boolean>
    checkApi: () => Promise<boolean>
}

export async function runBootDiagnostics(
    deps: BootDiagnosticsDeps,
): Promise<BootDiagnostics> {
    const checks: BootCheck[] = []

    try {
        const hasWallets = await deps.checkWallets()
        checks.push({
            id: 'wallet-detection',
            label: 'Wallet extension',
            status: hasWallets ? 'passed' : 'failed',
            message: hasWallets
                ? 'Stellar wallet detected'
                : 'No Stellar wallet extension found. Install Freighter, Rabet, or xBull.',
        })
    } catch {
        checks.push({
            id: 'wallet-detection',
            label: 'Wallet extension',
            status: 'failed',
            message: 'Wallet detection check failed.',
        })
    }

    try {
        const apiReachable = await deps.checkApi()
        checks.push({
            id: 'api-reachability',
            label: 'API reachability',
            status: apiReachable ? 'passed' : 'failed',
            message: apiReachable
                ? 'Backend API is reachable'
                : 'Cannot reach the backend API. The app may have limited functionality.',
        })
    } catch {
        checks.push({
            id: 'api-reachability',
            label: 'API reachability',
            status: 'failed',
            message: 'API reachability check failed.',
        })
    }

    return {
        checks,
        allPassed: checks.every((c) => c.status === 'passed'),
        timestamp: Date.now(),
    }
}
