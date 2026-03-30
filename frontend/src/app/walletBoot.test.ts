import { describe, expect, it, vi } from 'vitest'
import { WalletError } from '../utils/walletAdapters'
import {
    isAuthServiceUnavailable,
    resolveConsentAcceptedNavigation,
    runWalletReconnectBoot,
} from './walletBoot'

describe('isAuthServiceUnavailable', () => {
    it('treats 503-style messages as soft failures', () => {
        expect(isAuthServiceUnavailable(new Error('Request failed with 503'))).toBe(true)
        expect(isAuthServiceUnavailable(new Error('SERVICE_UNAVAILABLE'))).toBe(true)
        expect(isAuthServiceUnavailable(new Error('Auth not configured'))).toBe(true)
    })

    it('treats other errors as hard failures', () => {
        expect(isAuthServiceUnavailable(new Error('Invalid signature'))).toBe(false)
    })
})

describe('runWalletReconnectBoot', () => {
    it('restores session when consent was already given and auth succeeds', async () => {
        const authLogin = vi.fn().mockResolvedValue(undefined)
        const result = await runWalletReconnectBoot({
            reconnect: async () => 'GTESTKEY',
            checkConsent: async () => true,
            authLogin,
        })
        expect(result).toEqual({ outcome: 'dashboard', publicKey: 'GTESTKEY' })
        expect(authLogin).toHaveBeenCalledWith('GTESTKEY')
    })

    it('routes to consent when wallet reconnects but consent is missing', async () => {
        const result = await runWalletReconnectBoot({
            reconnect: async () => 'GTESTKEY',
            checkConsent: async () => false,
            authLogin: vi.fn(),
        })
        expect(result).toEqual({ outcome: 'needs_consent', publicKey: 'GTESTKEY' })
    })

    it('surfaces hard auth failure when consent exists but login fails', async () => {
        const result = await runWalletReconnectBoot({
            reconnect: async () => 'GTESTKEY',
            checkConsent: async () => true,
            authLogin: async () => {
                throw new Error('UNAUTHORIZED')
            },
        })
        expect(result.outcome).toBe('auth_failed')
        if (result.outcome === 'auth_failed') {
            expect(result.message).toMatch(/authentication failed/i)
        }
    })

    it('allows dashboard when auth is unavailable (JWT not configured)', async () => {
        const result = await runWalletReconnectBoot({
            reconnect: async () => 'GTESTKEY',
            checkConsent: async () => true,
            authLogin: async () => {
                throw new Error('503 Service Unavailable')
            },
        })
        expect(result).toEqual({ outcome: 'dashboard', publicKey: 'GTESTKEY' })
    })

    it('returns no_wallet when reconnect yields null', async () => {
        const result = await runWalletReconnectBoot({
            reconnect: async () => null,
            checkConsent: vi.fn(),
            authLogin: vi.fn(),
        })
        expect(result).toEqual({ outcome: 'no_wallet' })
    })

    it('maps wallet declined reconnect to a user-facing error', async () => {
        const result = await runWalletReconnectBoot({
            reconnect: async () => {
                throw new WalletError('declined', 'USER_DECLINED', 'freighter')
            },
            checkConsent: vi.fn(),
            authLogin: vi.fn(),
        })
        expect(result.outcome).toBe('reconnect_failed')
        if (result.outcome === 'reconnect_failed') {
            expect(result.message).toMatch(/declined/i)
        }
    })
})

describe('resolveConsentAcceptedNavigation', () => {
    it('moves into the dashboard when consent flow completes', () => {
        expect(resolveConsentAcceptedNavigation('GPK')).toEqual({
            targetView: 'dashboard',
            publicKey: 'GPK',
        })
    })

    it('returns null when there is no pending user', () => {
        expect(resolveConsentAcceptedNavigation(null)).toBeNull()
    })
})
