import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Keypair } from '@stellar/stellar-sdk'

// Mock authService so we don't need DB
vi.mock('../services/authService.js', () => ({
    issueTokens: vi.fn().mockResolvedValue({
        accessToken: 'mock-access',
        refreshToken: 'mock-refresh',
        expiresIn: 900,
        refreshExpiresIn: 604800,
    }),
}))

import { createChallenge, verifyChallenge, InvalidSignatureError } from '../services/stellarAuthService.js'

describe('Stellar address authentication (#886)', () => {
    const keypair = Keypair.random()
    const address = keypair.publicKey()

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('createChallenge returns a 64-char hex nonce for a valid Stellar address', () => {
        const nonce = createChallenge(address)
        expect(typeof nonce).toBe('string')
        expect(nonce).toHaveLength(64)
        expect(/^[0-9a-f]+$/.test(nonce)).toBe(true)
    })

    it('createChallenge throws for an invalid address', () => {
        expect(() => createChallenge('not-a-stellar-address')).toThrow('Invalid Stellar address')
    })

    it('verifyChallenge issues tokens when signature is valid', async () => {
        const nonce = createChallenge(address)
        const signature = keypair.sign(Buffer.from(nonce, 'utf8')).toString('base64')

        const tokens = await verifyChallenge(address, signature)

        expect(tokens.accessToken).toBe('mock-access')
        expect(tokens.refreshToken).toBe('mock-refresh')
    })

    it('verifyChallenge throws InvalidSignatureError when signature is wrong', async () => {
        createChallenge(address)
        const wrongSig = Buffer.alloc(64).toString('base64') // all-zero signature

        await expect(verifyChallenge(address, wrongSig)).rejects.toBeInstanceOf(InvalidSignatureError)
    })

    it('verifyChallenge throws when no challenge exists for address', async () => {
        const freshKeypair = Keypair.random()
        const sig = freshKeypair.sign(Buffer.from('nonce', 'utf8')).toString('base64')
        await expect(verifyChallenge(freshKeypair.publicKey(), sig)).rejects.toBeInstanceOf(InvalidSignatureError)
    })

    it('challenge is consumed after successful verification (one-time use)', async () => {
        const nonce = createChallenge(address)
        const signature = keypair.sign(Buffer.from(nonce, 'utf8')).toString('base64')

        await verifyChallenge(address, signature)

        // Second verify with same nonce must fail — challenge was deleted
        await expect(verifyChallenge(address, signature)).rejects.toBeInstanceOf(InvalidSignatureError)
    })
})
