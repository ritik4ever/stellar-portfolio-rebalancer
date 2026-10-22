/**
 * Stellar address authentication via challenge-response.
 *
 * Flow:
 *   1. Client calls POST /auth/challenge with { address }
 *   2. Server stores a random nonce keyed to the address (TTL: 5 min) and returns it
 *   3. Client signs the nonce with their Stellar private key and sends the signature
 *   4. Server verifies with Keypair.verify(), then issues JWT via authService
 */
import { Keypair } from '@stellar/stellar-sdk'
import { randomBytes } from 'node:crypto'
import { issueTokens } from './authService.js'
import { logger } from '../utils/logger.js'
import { authorizationContext, detectOtherNetwork, recordWalletAuthorization } from './walletAuthorization.js'
import type { WalletAuthorizationContext } from './walletAuthorization.js'

const CHALLENGE_TTL_MS = 5 * 60 * 1000  // 5 minutes
const CHALLENGE_CLEANUP_INTERVAL_MS = 60 * 1000  // GC every minute

export const MAX_CHALLENGE_ATTEMPTS = 3

interface ChallengeEntry {
    nonce: string
    expiresAt: number
    attempts: number
    context: WalletAuthorizationContext
}

// In-memory nonce store — keyed by address.
// One active challenge per address; requesting a new one invalidates the old one.
const challenges = new Map<string, ChallengeEntry>()

// Periodic GC of expired nonces
setInterval(() => {
    const now = Date.now()
    for (const [addr, entry] of challenges) {
        if (entry.expiresAt <= now) challenges.delete(addr)
    }
}, CHALLENGE_CLEANUP_INTERVAL_MS)

function isValidStellarAddress(address: string): boolean {
    try {
        Keypair.fromPublicKey(address)
        return true
    } catch {
        return false
    }
}

export function createChallenge(address: string): string {
    if (!isValidStellarAddress(address)) {
        throw new Error('Invalid Stellar address')
    }
    const nonce = randomBytes(32).toString('hex')
    const context = authorizationContext(address, nonce)
    challenges.set(address, { nonce, expiresAt: Date.now() + CHALLENGE_TTL_MS, attempts: 0, context })
    recordWalletAuthorization('stellar_challenge', context, 'pending', 'challenge_issued')
    return nonce
}

export async function verifyChallenge(
    address: string,
    signature: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresIn: number }> {
    if (!isValidStellarAddress(address)) {
        recordWalletAuthorization('stellar_challenge', authorizationContext(address), 'blocked', 'invalid_address', { retryable: false })
        throw new InvalidSignatureError('Invalid Stellar address')
    }

    const entry = challenges.get(address)
    if (!entry) {
        recordWalletAuthorization('stellar_challenge', authorizationContext(address), 'blocked', 'missing_challenge', { retryable: false })
        throw new InvalidSignatureError('No active challenge for this address')
    }
    if (entry.expiresAt <= Date.now()) {
        challenges.delete(address)
        recordWalletAuthorization('stellar_challenge', entry.context, 'blocked', 'expired_challenge', { retryable: false })
        throw new InvalidSignatureError('Challenge expired')
    }

    const keypair = Keypair.fromPublicKey(address)
    const nonceBuffer = Buffer.from(entry.nonce, 'utf8')
    const sigBuffer = Buffer.from(signature, 'base64')

    let valid: boolean
    try {
        valid = keypair.verify(nonceBuffer, sigBuffer)
    } catch {
        valid = false
    }

    if (!valid) {
        entry.attempts += 1
        const detectedNetwork = detectOtherNetwork(keypair, sigBuffer, entry.nonce, entry.context.expectedNetwork)
        recordWalletAuthorization('stellar_challenge', entry.context, 'blocked', detectedNetwork ? 'wrong_network' : 'invalid_signature', {
            attempts: entry.attempts,
            remainingAttempts: Math.max(0, MAX_CHALLENGE_ATTEMPTS - entry.attempts),
            retryable: entry.attempts < MAX_CHALLENGE_ATTEMPTS,
            ...(detectedNetwork ? { detectedNetwork } : {}),
        })
        if (entry.attempts >= MAX_CHALLENGE_ATTEMPTS) {
            challenges.delete(address)
            logger.warn('[stellarAuth] Invalid signature, maximum retry attempts exhausted', {
                address: address.slice(0, 8) + '...',
                attempts: entry.attempts,
            })
            throw new InvalidSignatureError('Signature verification failed: retry limit exceeded')
        }
        logger.warn('[stellarAuth] Invalid signature', {
            address: address.slice(0, 8) + '...',
            attempts: entry.attempts,
            remainingAttempts: MAX_CHALLENGE_ATTEMPTS - entry.attempts,
        })
        throw new InvalidSignatureError('Signature verification failed')
    }

    // Consume the challenge — one-time use
    challenges.delete(address)

    recordWalletAuthorization('stellar_challenge', entry.context, 'pending', 'issuing_tokens')
    try {
        const tokens = await issueTokens(address)
        recordWalletAuthorization('stellar_challenge', entry.context, 'success', 'authorized')
        return tokens
    } catch (error) {
        recordWalletAuthorization('stellar_challenge', entry.context, 'blocked', 'token_issuance_failed', { retryable: false })
        throw error
    }
}

export class InvalidSignatureError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'InvalidSignatureError'
    }
}
