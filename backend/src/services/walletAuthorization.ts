import { createHash } from 'node:crypto'
import { Keypair, Networks } from '@stellar/stellar-sdk'
import { logAudit } from '../utils/logger.js'

type Network = 'testnet' | 'mainnet' | 'unknown'
type Source = 'stellar_challenge' | 'wallet_signature'
type Reason = 'challenge_issued' | 'issuing_tokens' | 'authorized' | 'invalid_address'
    | 'missing_challenge' | 'expired_challenge' | 'invalid_signature' | 'wrong_network'
    | 'token_issuance_failed'

export interface WalletAuthorizationContext {
    walletId: string
    challengeId?: string
    expectedNetwork: Network
}

export function authorizationContext(address: string, challenge?: string): WalletAuthorizationContext {
    const network = (process.env.STELLAR_NETWORK || 'testnet').trim().toLowerCase()
    return {
        walletId: createHash('sha256').update(address).digest('hex'),
        ...(challenge ? { challengeId: createHash('sha256').update(challenge).digest('hex') } : {}),
        expectedNetwork: network === 'mainnet' || network === 'testnet' ? network : 'unknown',
    }
}

export function recordWalletAuthorization(
    source: Source,
    context: WalletAuthorizationContext,
    outcome: 'pending' | 'success' | 'blocked',
    reason: Reason,
    details: { attempts?: number; remainingAttempts?: number; retryable?: boolean; detectedNetwork?: Network } = {},
): void {
    logAudit('wallet_authorization', { source, ...context, outcome, reason, ...details })
}

/** Recognize only verified signatures over known network-scoped variants; never authorize them. */
export function detectOtherNetwork(
    keypair: Keypair,
    signature: Buffer,
    message: string,
    expected: Network,
): Network | undefined {
    const candidates: [Network, string][] = [['testnet', Networks.TESTNET], ['mainnet', Networks.PUBLIC]]
    if (expected === 'unknown') {
        return undefined
    }
    for (const [network, passphrase] of candidates) {
        if (network === expected) {
            continue
        }
        const messages = [`${passphrase}:${message}`]
        const prefix = 'stellar-rebalancer:auth:'
        if (message.startsWith(prefix)) {
            messages.push(`${prefix}${passphrase}:${message.slice(prefix.length)}`)
        }
        for (const candidate of messages) {
            try {
                if (keypair.verify(Buffer.from(candidate, 'utf8'), signature)) {
                    return network
                }
            } catch {
                return undefined
            }
        }
    }
    return undefined
}
