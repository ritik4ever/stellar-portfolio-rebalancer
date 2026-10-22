import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { Keypair, Networks } from '@stellar/stellar-sdk'

const doubles = vi.hoisted(() => ({
    logAudit: vi.fn(),
    issueTokens: vi.fn(),
}))
vi.mock('../services/authService.js', () => ({ issueTokens: doubles.issueTokens }))
vi.mock('../utils/logger.js', () => ({
    logAudit: doubles.logAudit,
    logger: { info: vi.fn(), warn: vi.fn() },
}))
import { createChallenge, verifyChallenge, MAX_CHALLENGE_ATTEMPTS } from '../services/stellarAuthService.js'

const sign = (keypair: Keypair, message: string) =>
    Buffer.from(keypair.sign(Buffer.from(message))).toString('base64')
const events = () => doubles.logAudit.mock.calls
    .filter(([action]) => action === 'wallet_authorization')
    .map(([, fields]) => fields)

describe('wallet authorization operator outcomes', () => {
    let keypair: Keypair
    let address: string

    beforeEach(() => {
        vi.clearAllMocks()
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
        vi.stubEnv('STELLAR_NETWORK', 'testnet')
        keypair = Keypair.random()
        address = keypair.publicKey()
        doubles.issueTokens.mockResolvedValue({ accessToken: 'access-test', refreshToken: 'refresh-test' })
    })
    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllEnvs()
    })

    it('records pending then success only after tokens are issued, without secret data', async () => {
        const nonce = createChallenge(address)
        const signature = sign(keypair, nonce)
        await verifyChallenge(address, signature)
        expect(events()).toEqual([
            expect.objectContaining({ source: 'stellar_challenge', outcome: 'pending', reason: 'challenge_issued', expectedNetwork: 'testnet' }),
            expect.objectContaining({ source: 'stellar_challenge', outcome: 'pending', reason: 'issuing_tokens' }),
            expect.objectContaining({ source: 'stellar_challenge', outcome: 'success', reason: 'authorized' }),
        ])
        expect(events()[0].challengeId).toBe(events()[2].challengeId)
        expect(events()[0].walletId).toBe(events()[2].walletId)
        const logged = JSON.stringify(doubles.logAudit.mock.calls)
        for (const secret of [nonce, signature, keypair.secret(), 'access-test', 'refresh-test', address]) {
            expect(logged).not.toContain(secret)
        }
        await expect(verifyChallenge(address, signature)).rejects.toThrow('No active challenge')
        expect(events().at(-1)).toMatchObject({ outcome: 'blocked', reason: 'missing_challenge' })
        expect(doubles.issueTokens).toHaveBeenCalledTimes(1)
    })

    it.each([
        ['testnet', Networks.PUBLIC, 'mainnet'],
        ['mainnet', Networks.TESTNET, 'testnet'],
    ])('diagnoses a valid other-network signature on %s without accepting it', async (network, passphrase, detected) => {
        vi.stubEnv('STELLAR_NETWORK', network)
        const nonce = createChallenge(address)
        const signature = sign(keypair, `${passphrase}:${nonce}`)
        await expect(verifyChallenge(address, signature)).rejects.toThrow('Signature verification failed')
        expect(events().at(-1)).toMatchObject({
            outcome: 'blocked', reason: 'wrong_network', expectedNetwork: network,
            detectedNetwork: detected, attempts: 1, remainingAttempts: 2, retryable: true,
        })
        expect(doubles.issueTokens).not.toHaveBeenCalled()
        await verifyChallenge(address, sign(keypair, nonce))
        expect(events().at(-1)).toMatchObject({ outcome: 'success' })
    })

    it('keeps the network context from issuance when configuration changes', async () => {
        const nonce = createChallenge(address)
        vi.stubEnv('STELLAR_NETWORK', 'mainnet')
        await expect(verifyChallenge(address, sign(keypair, `${Networks.PUBLIC}:${nonce}`))).rejects.toThrow()
        expect(events().at(-1)).toMatchObject({ expectedNetwork: 'testnet', detectedNetwork: 'mainnet', reason: 'wrong_network' })
    })

    it('reports exhausted retries and consumes the challenge', async () => {
        const nonce = createChallenge(address)
        for (let attempt = 1; attempt <= MAX_CHALLENGE_ATTEMPTS; attempt++) {
            await expect(verifyChallenge(address, sign(keypair, `${Networks.PUBLIC}:${nonce}`))).rejects.toThrow('Signature verification failed')
        }
        expect(events().at(-1)).toMatchObject({
            outcome: 'blocked', reason: 'wrong_network', attempts: 3, remainingAttempts: 0, retryable: false,
        })
        await expect(verifyChallenge(address, sign(keypair, nonce))).rejects.toThrow('No active challenge')
        expect(doubles.issueTokens).not.toHaveBeenCalled()
    })

    it.each(['other_account', 'malformed', 'unknown_message', 'same_network'])('does not misclassify %s as wrong-network', async (scenario) => {
        const nonce = createChallenge(address)
        const signature = scenario === 'other_account' ? sign(Keypair.random(), `${Networks.PUBLIC}:${nonce}`)
            : scenario === 'malformed' ? 'not-a-signature'
            : sign(keypair, scenario === 'same_network' ? `${Networks.TESTNET}:${nonce}` : 'unrecognized-message')
        await expect(verifyChallenge(address, signature)).rejects.toThrow('Signature verification failed')
        expect(events().at(-1)).toMatchObject({ outcome: 'blocked', reason: 'invalid_signature' })
        expect(events().at(-1)).not.toHaveProperty('detectedNetwork')
        expect(doubles.issueTokens).not.toHaveBeenCalled()
    })

    it('records missing and expired challenges without issuing tokens', async () => {
        await expect(verifyChallenge(address, 'dummy')).rejects.toThrow('No active challenge')
        expect(events().at(-1)).toMatchObject({ outcome: 'blocked', reason: 'missing_challenge', retryable: false })
        const nonce = createChallenge(address)
        vi.setSystemTime(Date.now() + 5 * 60 * 1000)
        await expect(verifyChallenge(address, sign(keypair, nonce))).rejects.toThrow('Challenge expired')
        expect(events().at(-1)).toMatchObject({ outcome: 'blocked', reason: 'expired_challenge', retryable: false })
        expect(doubles.issueTokens).not.toHaveBeenCalled()
    })

    it('reports invalid addresses using a safe identifier', async () => {
        const invalid = 'invalid-address-with-sensitive-input'
        await expect(verifyChallenge(invalid, 'dummy')).rejects.toThrow('Invalid Stellar address')
        expect(events().at(-1)).toMatchObject({ outcome: 'blocked', reason: 'invalid_address' })
        expect(JSON.stringify(events())).not.toContain(invalid)
    })

    it('distinguishes delayed token issuance from success and a safe terminal failure', async () => {
        let finish!: (value: object) => void
        doubles.issueTokens.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
        const nonce = createChallenge(address)
        const pending = verifyChallenge(address, sign(keypair, nonce))
        expect(events().at(-1)).toMatchObject({ outcome: 'pending', reason: 'issuing_tokens' })
        finish({ accessToken: 'access-test' })
        await pending
        expect(events().at(-1)).toMatchObject({ outcome: 'success' })
        const next = createChallenge(address)
        doubles.issueTokens.mockRejectedValueOnce(new Error('private database details'))
        await expect(verifyChallenge(address, sign(keypair, next))).rejects.toThrow('private database details')
        expect(events().at(-1)).toMatchObject({ outcome: 'blocked', reason: 'token_issuance_failed', retryable: false })
        expect(JSON.stringify(events())).not.toContain('private database details')
    })
})
