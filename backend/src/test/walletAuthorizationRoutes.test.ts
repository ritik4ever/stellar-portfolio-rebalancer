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

    it('preserves successful wallet login and its existing session audit', async () => {
        const keypair = Keypair.random()
        const address = keypair.publicKey()
        const challenge = await request(app).post('/api/auth/challenge').send({ address }).expect(200)
        const message = challenge.body.data.challenge as string
        const signature = Buffer.from(keypair.sign(Buffer.from(message))).toString('base64')
        const response = await request(app).post('/api/auth/login').send({ address, signature }).expect(200)
        expect(response.body.data.accessToken).toBeTruthy()
        expect(events().at(-1)).toMatchObject({ source: 'wallet_signature', outcome: 'success', reason: 'authorized' })
        expect(doubles.logAudit).toHaveBeenCalledWith('auth_login', expect.objectContaining({ userAddress: address }))
        expect(doubles.createRefreshToken).toHaveBeenCalledTimes(1)
    })
})
