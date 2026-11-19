import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { Keypair, Networks } from '@stellar/stellar-sdk'

const doubles = vi.hoisted(() => ({
    logAudit: vi.fn(),
    createRefreshToken: vi.fn().mockResolvedValue(undefined),
    createRefreshTokenFamily: vi.fn().mockResolvedValue(undefined),
    advanceRefreshTokenFamily: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../utils/logger.js', () => ({
    logAudit: doubles.logAudit,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../db/refreshTokenDb.js', () => ({
    ...doubles,
    findRefreshToken: vi.fn(), findRefreshTokenById: vi.fn(), deleteRefreshTokenById: vi.fn(),
    deleteAllRefreshTokensForUser: vi.fn(), generateRefreshTokenId: vi.fn(() => 'session-id'),
    generateRefreshTokenFamilyId: vi.fn(() => 'family-id'), getRefreshTokenFamily: vi.fn(),
    revokeRefreshTokenFamily: vi.fn(), recordRotatedRefreshToken: vi.fn(), findRotatedRefreshToken: vi.fn(),
}))
vi.mock('../observability/metrics.js', () => ({ recordAuthSecurityEvent: vi.fn() }))
vi.mock('../services/tokenRevocation.js', () => ({ tokenRevocationService: {} }))
vi.mock('../middleware/requireJwt.js', () => ({ requireJwt: vi.fn() }))
vi.mock('../middleware/rateLimit.js', () => ({ authRateLimiter: vi.fn() }))

import { authRouter } from '../api/authRoutes.js'

const app = express()
app.use(express.json())
app.use('/api/auth', authRouter)
const events = () => doubles.logAudit.mock.calls
    .filter(([action]) => action === 'wallet_authorization')
    .map(([, fields]) => fields)

describe('mounted wallet authorization flow', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.stubEnv('JWT_SECRET', 'x'.repeat(48))
        vi.stubEnv('STELLAR_NETWORK', 'testnet')
    })
    afterEach(() => vi.unstubAllEnvs())

    it('reports the actual challenge/login source and rejects a different-network signature before persistence', async () => {
        const keypair = Keypair.random()
        const address = keypair.publicKey()
        const challenge = await request(app).post('/api/auth/challenge').send({ address }).expect(200)
        const message = challenge.body.data.challenge as string
        const signature = Buffer.from(keypair.sign(Buffer.from(`${Networks.PUBLIC}:${message}`))).toString('base64')
        await request(app).post('/api/auth/login').send({ address, signature }).expect(401)
        expect(events()).toEqual([
            expect.objectContaining({ source: 'wallet_signature', outcome: 'pending', reason: 'challenge_issued' }),
            expect.objectContaining({ source: 'wallet_signature', outcome: 'blocked', reason: 'wrong_network', detectedNetwork: 'mainnet' }),
        ])
        expect(doubles.createRefreshTokenFamily).not.toHaveBeenCalled()
        expect(doubles.createRefreshToken).not.toHaveBeenCalled()
        const logged = JSON.stringify(doubles.logAudit.mock.calls)
        expect(logged).not.toContain(message)
        expect(logged).not.toContain(signature)
    })

    it('preserves successful wallet login and records success after token persistence', async () => {
        const keypair = Keypair.random()
        const address = keypair.publicKey()
        const challenge = await request(app).post('/api/auth/challenge').send({ address }).expect(200)
        const message = challenge.body.data.challenge as string
        const signature = Buffer.from(keypair.sign(Buffer.from(message))).toString('base64')
        const response = await request(app).post('/api/auth/login').send({ address, signature }).expect(200)
        expect(response.body.data.accessToken).toBeTruthy()
        expect(events()).toEqual([
            expect.objectContaining({ source: 'wallet_signature', outcome: 'pending', reason: 'challenge_issued' }),
            expect.objectContaining({ source: 'wallet_signature', outcome: 'pending', reason: 'issuing_tokens' }),
            expect.objectContaining({ source: 'wallet_signature', outcome: 'success', reason: 'authorized' }),
        ])
        expect(events()[0].walletId).toBe(events()[2].walletId)
        expect(events()[0].challengeId).toBe(events()[2].challengeId)
        expect(events()[0].expectedNetwork).toBe(events()[2].expectedNetwork)
        expect(doubles.logAudit).toHaveBeenCalledWith('auth_login', expect.objectContaining({ userAddress: address }))
        const persistedLoginIndex = doubles.logAudit.mock.calls.findIndex(([action]) => action === 'auth_login')
        const authorizationSuccessIndex = doubles.logAudit.mock.calls.findIndex(([action, fields]) =>
            action === 'wallet_authorization' && fields.outcome === 'success')
        expect(authorizationSuccessIndex).toBeGreaterThan(persistedLoginIndex)
        expect(doubles.createRefreshTokenFamily).toHaveBeenCalledWith('family-id', address)
        expect(doubles.createRefreshToken).toHaveBeenCalledTimes(1)
        expect(doubles.createRefreshToken.mock.calls[0][1]).toBe(address)
    })

    it('records a blocked outcome and returns 500 when token persistence fails', async () => {
        const keypair = Keypair.random()
        const address = keypair.publicKey()
        const challenge = await request(app).post('/api/auth/challenge').send({ address }).expect(200)
        const message = challenge.body.data.challenge as string
        const signature = Buffer.from(keypair.sign(Buffer.from(message))).toString('base64')
        doubles.createRefreshToken.mockRejectedValueOnce(new Error('private database details'))

        const response = await request(app).post('/api/auth/login').send({ address, signature }).expect(500)

        expect(response.body.success).toBe(false)
        expect(events()).toEqual([
            expect.objectContaining({ source: 'wallet_signature', outcome: 'pending', reason: 'challenge_issued' }),
            expect.objectContaining({ source: 'wallet_signature', outcome: 'pending', reason: 'issuing_tokens' }),
            expect.objectContaining({ source: 'wallet_signature', outcome: 'blocked', reason: 'token_issuance_failed', retryable: false }),
        ])
        expect(events()[0].walletId).toBe(events()[2].walletId)
        expect(events()[0].challengeId).toBe(events()[2].challengeId)
        expect(events()[0].expectedNetwork).toBe(events()[2].expectedNetwork)
        expect(events().some(event => event.outcome === 'success')).toBe(false)
        expect(doubles.logAudit).not.toHaveBeenCalledWith('auth_login', expect.anything())
        expect(JSON.stringify(events())).not.toContain('private database details')

        // A failed persistence attempt still consumes the verified challenge;
        // a replay stays bound to its original context and cannot issue a session.
        await request(app).post('/api/auth/login').send({ address, signature }).expect(401)
        expect(events().at(-1)).toMatchObject({
            source: 'wallet_signature', outcome: 'blocked', reason: 'reused_challenge',
            walletId: events()[0].walletId,
            challengeId: events()[0].challengeId,
            expectedNetwork: events()[0].expectedNetwork,
        })
        expect(doubles.createRefreshTokenFamily).toHaveBeenCalledTimes(1)
        expect(doubles.createRefreshToken).toHaveBeenCalledTimes(1)
    })

    it('allows only one concurrent login and preserves the challenge context while issuance is pending', async () => {
        const keypair = Keypair.random()
        const address = keypair.publicKey()
        const challenge = await request(app).post('/api/auth/challenge').send({ address }).expect(200)
        const message = challenge.body.data.challenge as string
        const signature = Buffer.from(keypair.sign(Buffer.from(message))).toString('base64')

        let releasePersistence!: () => void
        let markPersistenceStarted!: () => void
        const persistenceGate = new Promise<void>(resolve => { releasePersistence = resolve })
        const persistenceStarted = new Promise<void>(resolve => { markPersistenceStarted = resolve })
        doubles.createRefreshTokenFamily.mockImplementationOnce(async () => {
            markPersistenceStarted()
            await persistenceGate
        })

        const firstLogin = request(app).post('/api/auth/login').send({ address, signature }).then(response => response)
        await persistenceStarted
        expect(events().at(-1)).toMatchObject({ outcome: 'pending', reason: 'issuing_tokens' })
        expect(events().some(event => event.outcome === 'success')).toBe(false)
        vi.stubEnv('STELLAR_NETWORK', 'mainnet')
        const replay = await request(app).post('/api/auth/login').send({ address, signature }).expect(401)
        expect(replay.body.error.code).toBe('UNAUTHORIZED')
        expect(events().at(-1)).toMatchObject({
            source: 'wallet_signature', outcome: 'blocked', reason: 'reused_challenge',
            walletId: events()[0].walletId,
            challengeId: events()[0].challengeId,
            expectedNetwork: 'testnet',
        })

        releasePersistence()
        const success = await firstLogin
        expect(success.status).toBe(200)
        expect(success.body.data.accessToken).toBeTruthy()
        expect(events().at(-1)).toMatchObject({
            source: 'wallet_signature', outcome: 'success', reason: 'authorized',
            walletId: events()[0].walletId,
            challengeId: events()[0].challengeId,
            expectedNetwork: 'testnet',
        })
        expect(doubles.createRefreshTokenFamily).toHaveBeenCalledTimes(1)
        expect(doubles.createRefreshToken).toHaveBeenCalledTimes(1)
    })
})
