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

const CHALLENGE_TTL_MS = 5 * 60 * 1000  // 5 minutes
const CHALLENGE_CLEANUP_INTERVAL_MS = 60 * 1000  // GC every minute

interface ChallengeEntry {
    nonce: string
    expiresAt: number
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
    challenges.set(address, { nonce, expiresAt: Date.now() + CHALLENGE_TTL_MS })
    return nonce
}

export async function verifyChallenge(
    address: string,
    signature: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresIn: number }> {
    if (!isValidStellarAddress(address)) {
        throw new InvalidSignatureError('Invalid Stellar address')
    }

    const entry = challenges.get(address)
    if (!entry) {
        throw new InvalidSignatureError('No active challenge for this address')
    }
    if (entry.expiresAt <= Date.now()) {
        challenges.delete(address)
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
        logger.warn('[stellarAuth] Invalid signature', { address: address.slice(0, 8) + '...' })
        throw new InvalidSignatureError('Signature verification failed')
    }

    // Consume the challenge — one-time use
    challenges.delete(address)

    return issueTokens(address)
}

export class InvalidSignatureError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'InvalidSignatureError'
    }
}
