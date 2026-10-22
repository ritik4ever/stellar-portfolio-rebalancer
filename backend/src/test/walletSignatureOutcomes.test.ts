import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Keypair, Networks } from '@stellar/stellar-sdk'

const doubles = vi.hoisted(() => ({
    logAudit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn() },
    recordAuthSecurityEvent: vi.fn(),
}))
vi.mock('../utils/logger.js', () => ({ logger: doubles.logger, logAudit: doubles.logAudit }))
vi.mock('../observability/metrics.js', () => ({ recordAuthSecurityEvent: doubles.recordAuthSecurityEvent }))

import { issueChallenge, verifyWalletSignature, getFailedSigAttempts } from '../services/walletSignatureService.js'
import { authorizationContext, detectOtherNetwork } from '../services/walletAuthorization.js'

const sign = (keypair: Keypair, message: string) =>
    Buffer.from(keypair.sign(Buffer.from(message))).toString('base64')
const events = () => doubles.logAudit.mock.calls
    .filter(([action]) => action === 'wallet_authorization')
    .map(([, fields]) => fields)

describe('legacy wallet signature outcomes', () => {
    let keypair: Keypair
    let address: string
    beforeEach(() => {
        vi.clearAllMocks()
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
        vi.stubEnv('STELLAR_NETWORK', 'testnet')
        keypair = Keypair.random()
        address = keypair.publicKey()
    })
    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllEnvs()
    })

    it('correlates pending and successful verification without logging signing material', () => {
        const message = issueChallenge(address)
        const signature = sign(keypair, message)
        expect(verifyWalletSignature(address, signature)).toBe(true)
        expect(events()).toEqual([
            expect.objectContaining({ source: 'wallet_signature', outcome: 'pending', reason: 'challenge_issued' }),
            expect.objectContaining({ source: 'wallet_signature', outcome: 'success', reason: 'authorized' }),
        ])
        expect(events()[0].challengeId).toBe(events()[1].challengeId)
        expect(JSON.stringify(doubles)).not.toContain(message)
        expect(JSON.stringify(events())).not.toContain(address)
        const logged = JSON.stringify([...doubles.logAudit.mock.calls, ...doubles.logger.info.mock.calls, ...doubles.logger.warn.mock.calls])
        for (const secret of [message, signature, keypair.secret()]) {
            expect(logged).not.toContain(secret)
        }
        expect(verifyWalletSignature(address, signature)).toBe(false)
        expect(events().at(-1)).toMatchObject({ outcome: 'blocked', reason: 'missing_challenge' })
    })

    it.each([
        ['testnet', Networks.PUBLIC, 'mainnet'],
        ['mainnet', Networks.TESTNET, 'testnet'],
    ])('identifies other-network signing on %s and retains one-use rejection', (network, passphrase, detected) => {
        vi.stubEnv('STELLAR_NETWORK', network)
        const message = issueChallenge(address)
        const nonce = message.slice('stellar-rebalancer:auth:'.length)
        const signature = sign(keypair, `stellar-rebalancer:auth:${passphrase}:${nonce}`)
        expect(verifyWalletSignature(address, signature)).toBe(false)
        expect(events().at(-1)).toMatchObject({
            source: 'wallet_signature', outcome: 'blocked', reason: 'wrong_network',
            expectedNetwork: network, detectedNetwork: detected, retryable: false,
        })
        expect(getFailedSigAttempts(address)).toBe(1)
        expect(doubles.recordAuthSecurityEvent).toHaveBeenCalledWith('failed_signature')
        expect(verifyWalletSignature(address, sign(keypair, message))).toBe(false)
    })

    it.each(['other_account', 'malformed', 'unrecognized'])('records %s as invalid signature', (scenario) => {
        const message = issueChallenge(address)
        const signature = scenario === 'malformed' ? 'invalid' : sign(scenario === 'other_account' ? Keypair.random() : keypair, 'unrecognized')
        expect(verifyWalletSignature(address, signature)).toBe(false)
        expect(events().at(-1)).toMatchObject({ outcome: 'blocked', reason: 'invalid_signature', retryable: false })
        expect(events().at(-1)).not.toHaveProperty('detectedNetwork')
        expect(getFailedSigAttempts(address)).toBe(1)
        expect(verifyWalletSignature(address, sign(keypair, message))).toBe(false)
    })

    it('records expired challenges and leaves existing metrics intact', () => {
        const message = issueChallenge(address)
        vi.advanceTimersByTime(5 * 60 * 1000 + 1)
        expect(verifyWalletSignature(address, sign(keypair, message))).toBe(false)
        expect(events().at(-1)).toMatchObject({ outcome: 'blocked', reason: 'expired_challenge', retryable: false })
        expect(doubles.recordAuthSecurityEvent).toHaveBeenCalledWith('expired_challenge')
    })

    it('fails closed for invalid public keys', () => {
        issueChallenge('invalid')
        expect(verifyWalletSignature('invalid', 'dummy')).toBe(false)
        expect(events().at(-1)).toMatchObject({ outcome: 'blocked', reason: 'invalid_signature' })
    })

    it('uses unknown for unsupported configuration rather than inventing a network match', () => {
        vi.stubEnv('STELLAR_NETWORK', 'unsupported')
        const message = issueChallenge(address)
        expect(verifyWalletSignature(address, sign(keypair, `${Networks.PUBLIC}:${message}`))).toBe(false)
        expect(events().at(-1)).toMatchObject({ expectedNetwork: 'unknown', reason: 'invalid_signature' })
    })

    it('normalizes configuration and defaults to testnet', () => {
        vi.stubEnv('STELLAR_NETWORK', ' MAINNET ')
        expect(authorizationContext(address)).toMatchObject({ expectedNetwork: 'mainnet' })
        vi.stubEnv('STELLAR_NETWORK', '')
        expect(authorizationContext(address)).toMatchObject({ expectedNetwork: 'testnet' })
        expect(detectOtherNetwork(keypair, Buffer.from('bad'), 'nonce', 'testnet')).toBeUndefined()
    })
})
