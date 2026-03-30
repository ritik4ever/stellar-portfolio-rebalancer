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
