/**
 * Auth integration tests — #173
 *
 * End-to-end coverage for all auth flows against a real Express app backed by
 * an isolated in-process SQLite database, with no mocks of authService or the DB.
 *
 * Flows covered:
 *  - Challenge issuance
 *  - Wallet-signed login (success + failure)
 *  - Token structure validation
 *  - Refresh token rotation
 *  - Refresh token single-use enforcement (replay prevention)
 *  - Logout (single session)
 *  - Logout-all (all sessions for a user)
 *  - Protected routes failing without / with valid token
 *  - Expired / tampered token rejection
 *  - Cross-user token ownership enforcement
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { Express } from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { Keypair } from '@stellar/stellar-sdk'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── Constants ──────────────────────────────────────────────────────────────────

const TEST_JWT_SECRET = 'auth-integration-test-secret-min32!!'

// ── App factory ───────────────────────────────────────────────────────────────

let app: Express
let testDbPath: string
const envBackup: NodeJS.ProcessEnv = { ...process.env }

beforeAll(async () => {
    const testDir = join(tmpdir(), `stellar-auth-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    testDbPath = join(testDir, 'auth-e2e.db')

    // Isolate env so existing DB / JWT secrets don't leak into this suite
    vi.resetModules()
    process.env = { ...envBackup }
    delete process.env.DATABASE_URL
    process.env.DB_PATH = testDbPath
    process.env.JWT_SECRET = TEST_JWT_SECRET
    process.env.NODE_ENV = 'test'
    process.env.ENABLE_DEMO_DB_SEED = 'false'
    process.env.DEMO_MODE = 'true'
    // Relax rate limits so tests don't get 429s
    process.env.RATE_LIMIT_AUTH_MAX = '200'
    process.env.RATE_LIMIT_BURST_MAX = '500'
    process.env.RATE_LIMIT_WRITE_MAX = '200'
    process.env.RATE_LIMIT_WRITE_BURST_MAX = '500'
    process.env.RATE_LIMIT_CRITICAL_MAX = '200'

    const express = (await import('express')).default
    const cors = (await import('cors')).default
    const { portfolioRouter } = await import('../api/routes.js')
    const { authRouter } = await import('../api/authRoutes.js')

    app = express()
    app.use(cors({ origin: true, credentials: true }))
    app.use(express.json({ limit: '10mb' }))
    app.set('trust proxy', 1)
    app.use('/api', portfolioRouter)
    app.use('/api/auth', authRouter)
})

afterAll(() => {
    process.env = { ...envBackup }
    if (existsSync(testDbPath)) {
        try { rmSync(testDbPath, { force: true }) } catch { /* ignore */ }
    }
    vi.restoreAllMocks()
})

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Request a new Stellar wallet keypair, request a challenge for it from the
 * API, sign the challenge, then POST /api/auth/login. Returns the full token
 * pair on success.
 */
async function loginWithWallet(keypair: Keypair) {
    const address = keypair.publicKey()

    // 1. Get challenge
    const challengeRes = await request(app)
        .post('/api/auth/challenge')
        .send({ address })
        .expect(200)
    expect(challengeRes.body.success).toBe(true)
    const challenge: string = challengeRes.body.data.challenge
    expect(typeof challenge).toBe('string')
    expect(challenge.startsWith('stellar-rebalancer:auth:')).toBe(true)

    // 2. Sign challenge and login
    const sig = keypair.sign(Buffer.from(challenge, 'utf8')).toString('base64')
    const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ address, signature: sig })
        .expect(200)
    expect(loginRes.body.success).toBe(true)
    return loginRes.body.data as {
        accessToken: string
        refreshToken: string
        expiresIn: number
        refreshExpiresIn: number
    }
}

// ── Challenge tests ───────────────────────────────────────────────────────────

describe('POST /api/auth/challenge', () => {
    it('returns a challenge string for a valid Stellar address', async () => {
        const kp = Keypair.random()
        const res = await request(app)
            .post('/api/auth/challenge')
            .send({ address: kp.publicKey() })
            .expect(200)

        expect(res.body.success).toBe(true)
        expect(typeof res.body.data.challenge).toBe('string')
        expect(res.body.data.challenge).toMatch(/^stellar-rebalancer:auth:/)
    })

    it('returns 400 when address is missing', async () => {
        const res = await request(app)
            .post('/api/auth/challenge')
            .send({})
            .expect(400)

        expect(res.body.success).toBe(false)
        expect(res.body.error?.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 when address is an empty string', async () => {
        const res = await request(app)
            .post('/api/auth/challenge')
            .send({ address: '   ' })
            .expect(400)

        expect(res.body.error?.code).toBe('VALIDATION_ERROR')
    })

    it('issues a new challenge each time, replacing the old one', async () => {
        const kp = Keypair.random()
        const address = kp.publicKey()

        const first = await request(app)
            .post('/api/auth/challenge')
            .send({ address })
            .expect(200)
        const second = await request(app)
            .post('/api/auth/challenge')
            .send({ address })
            .expect(200)

        // Challenges must differ and the first is invalidated
        expect(first.body.data.challenge).not.toBe(second.body.data.challenge)
    })
})

// ── Login tests ───────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
    it('issues accessToken and refreshToken on valid wallet signature', async () => {
        const kp = Keypair.random()
        const tokens = await loginWithWallet(kp)

        expect(typeof tokens.accessToken).toBe('string')
        expect(typeof tokens.refreshToken).toBe('string')
        expect(tokens.expiresIn).toBeGreaterThan(0)
        expect(tokens.refreshExpiresIn).toBeGreaterThan(0)
    })

    it('access token payload contains correct subject and type', async () => {
        const kp = Keypair.random()
        const { accessToken } = await loginWithWallet(kp)

        const decoded = jwt.decode(accessToken) as Record<string, unknown>
        expect(decoded.sub).toBe(kp.publicKey())
        expect(decoded.type).toBe('access')
    })

    it('refresh token payload contains correct subject and type', async () => {
        const kp = Keypair.random()
        const { refreshToken } = await loginWithWallet(kp)

        const decoded = jwt.decode(refreshToken) as Record<string, unknown>
        expect(decoded.sub).toBe(kp.publicKey())
        expect(decoded.type).toBe('refresh')
    })

    it('returns 401 for an invalid signature', async () => {
        const kp = Keypair.random()
        const address = kp.publicKey()

        // First get a challenge
        await request(app).post('/api/auth/challenge').send({ address }).expect(200)

        // Sign with the wrong key
        const wrongKp = Keypair.random()
        const fakeSig = wrongKp.sign(Buffer.from('not-the-real-challenge')).toString('base64')

        const res = await request(app)
            .post('/api/auth/login')
            .send({ address, signature: fakeSig })
            .expect(401)

        expect(res.body.error?.code).toBe('UNAUTHORIZED')
    })

    it('returns 401 when no challenge has been issued for the address', async () => {
        const kp = Keypair.random() // never requested a challenge
        const fakeSig = kp.sign(Buffer.from('stellar-rebalancer:auth:nochallenge')).toString('base64')

        const res = await request(app)
            .post('/api/auth/login')
            .send({ address: kp.publicKey(), signature: fakeSig })
            .expect(401)

        expect(res.body.error?.code).toBe('UNAUTHORIZED')
    })

    it('returns 400 when address is missing', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ signature: 'abc123==' })
            .expect(400)

        expect(res.body.error?.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 when signature is missing', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ address: Keypair.random().publicKey() })
            .expect(400)

        expect(res.body.error?.code).toBe('VALIDATION_ERROR')
    })
})

// ── Refresh token rotation ────────────────────────────────────────────────────

describe('POST /api/auth/refresh — token rotation', () => {
    it('returns a new token pair when a valid refresh token is presented', async () => {
        const kp = Keypair.random()
        const { refreshToken: rt1 } = await loginWithWallet(kp)

        const res = await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken: rt1 })
            .expect(200)

        expect(res.body.success).toBe(true)
        const { accessToken, refreshToken: rt2 } = res.body.data
        expect(typeof accessToken).toBe('string')
        expect(typeof rt2).toBe('string')
        // Rotated refresh token must differ from the original
        expect(rt2).not.toBe(rt1)
    })

    it('new access token still belongs to the same user', async () => {
        const kp = Keypair.random()
        const { refreshToken } = await loginWithWallet(kp)

        const refreshRes = await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken })
            .expect(200)

        const decoded = jwt.decode(refreshRes.body.data.accessToken) as Record<string, unknown>
        expect(decoded.sub).toBe(kp.publicKey())
        expect(decoded.type).toBe('access')
    })

    it('rejects 401 when refresh token is reused (single-use enforcement)', async () => {
        const kp = Keypair.random()
        const { refreshToken } = await loginWithWallet(kp)

        // First use — succeeds
        await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken })
            .expect(200)

        // Second use — must be rejected (token is consumed)
        const replay = await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken })
            .expect(401)

        expect(replay.body.error?.code).toBe('UNAUTHORIZED')
    })

    it('returns 401 for an arbitrary string passed as refresh token', async () => {
        const res = await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken: 'not-a-real-token' })
            .expect(401)

        expect(res.body.error?.code).toBe('UNAUTHORIZED')
    })

    it('returns 401 for a token signed with a different secret', async () => {
        const wrongSecret = 'completely-different-secret-of-32chars!!'
        const forgery = jwt.sign(
            { sub: 'GHACKER', type: 'refresh', jti: 'fake-jti' },
            wrongSecret,
            { expiresIn: 3600 }
        )

        const res = await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken: forgery })
            .expect(401)

        expect(res.body.error?.code).toBe('UNAUTHORIZED')
    })

    it('returns 400 when refreshToken field is missing', async () => {
        const res = await request(app)
            .post('/api/auth/refresh')
            .send({})
            .expect(400)

        expect(res.body.error?.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 when refreshToken is not a string', async () => {
        const res = await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken: 12345 })
            .expect(400)

        expect(res.body.error?.code).toBe('VALIDATION_ERROR')
    })

    it('returns 401 for an expired refresh token', async () => {
        const expired = jwt.sign(
            { sub: 'GEXPIRED', type: 'refresh', jti: 'expired-jti' },
            TEST_JWT_SECRET,
            { expiresIn: -1 } // already expired
        )

        const res = await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken: expired })
            .expect(401)

        expect(res.body.error?.code).toBe('UNAUTHORIZED')
    })
})

// ── Logout (single session) ───────────────────────────────────────────────────

describe('POST /api/auth/logout — single session', () => {
    it('returns 200 and the refresh token is revoked after logout', async () => {
        const kp = Keypair.random()
        const { accessToken, refreshToken } = await loginWithWallet(kp)

        // Logout the current session
        const logoutRes = await request(app)
            .post('/api/auth/logout')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ refreshToken })
            .expect(200)

        expect(logoutRes.body.success).toBe(true)
        expect(logoutRes.body.data.message).toMatch(/logged out/i)

        // Refresh token must now be rejected
        const refreshAfter = await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken })
            .expect(401)

        expect(refreshAfter.body.error?.code).toBe('UNAUTHORIZED')
    })

    it('returns 401 without an Authorization header', async () => {
        const kp = Keypair.random()
        const { refreshToken } = await loginWithWallet(kp)

        const res = await request(app)
            .post('/api/auth/logout')
            .send({ refreshToken })
            .expect(401)

        expect(res.body.error?.code).toBe('UNAUTHORIZED')
    })

    it('returns 401 with an invalid bearer token', async () => {
        const res = await request(app)
            .post('/api/auth/logout')
            .set('Authorization', 'Bearer invalid.token.here')
            .send({ refreshToken: 'any-token' })
            .expect(401)

        expect(res.body.error?.code).toBe('UNAUTHORIZED')
    })

    it('other sessions remain valid after a single-session logout', async () => {
        const kp = Keypair.random()
        const first = await loginWithWallet(kp)
        // Obtain a second independent session
        const second = await loginWithWallet(kp)

        // Log out only the first session's refresh token
        await request(app)
            .post('/api/auth/logout')
            .set('Authorization', `Bearer ${first.accessToken}`)
            .send({ refreshToken: first.refreshToken })
            .expect(200)

        // Second session's refresh token must still work
        const refreshRes = await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken: second.refreshToken })
            .expect(200)

        expect(refreshRes.body.success).toBe(true)
    })
})

// ── Logout-all ────────────────────────────────────────────────────────────────

describe('POST /api/auth/logout-all — all sessions', () => {
    it('revokes all refresh tokens for the user', async () => {
        const kp = Keypair.random()
        const sessionA = await loginWithWallet(kp)
        const sessionB = await loginWithWallet(kp)
        const sessionC = await loginWithWallet(kp)

        // Logout-all with any valid access token
        const res = await request(app)
            .post('/api/auth/logout-all')
            .set('Authorization', `Bearer ${sessionA.accessToken}`)
            .send({})
            .expect(200)

        expect(res.body.success).toBe(true)

        // All three refresh tokens must now be rejected
        for (const { refreshToken } of [sessionA, sessionB, sessionC]) {
            const out = await request(app)
                .post('/api/auth/refresh')
                .send({ refreshToken })
                .expect(401)
            expect(out.body.error?.code).toBe('UNAUTHORIZED')
        }
    })

    it('returns 401 without an Authorization header', async () => {
        const res = await request(app)
            .post('/api/auth/logout-all')
            .send({})
            .expect(401)

        expect(res.body.error?.code).toBe('UNAUTHORIZED')
    })

    it('returns 403 when body address does not match JWT subject', async () => {
        const kp = Keypair.random()
        const { accessToken } = await loginWithWallet(kp)
        const otherAddress = Keypair.random().publicKey()

        const res = await request(app)
            .post('/api/auth/logout-all')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ address: otherAddress })
            .expect(403)

        expect(res.body.error?.code).toBe('FORBIDDEN')
    })

    it('accepts matching body address and still revokes all tokens', async () => {
        const kp = Keypair.random()
        const address = kp.publicKey()
        const { accessToken, refreshToken } = await loginWithWallet(kp)

        await request(app)
            .post('/api/auth/logout-all')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ address })
            .expect(200)

        await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken })
            .expect(401)
    })

    it('does not affect other users sessions', async () => {
        const kp1 = Keypair.random()
        const kp2 = Keypair.random()
        const user1 = await loginWithWallet(kp1)
        const user2 = await loginWithWallet(kp2)

        // kp1 logs out all their sessions
        await request(app)
            .post('/api/auth/logout-all')
            .set('Authorization', `Bearer ${user1.accessToken}`)
            .send({})
            .expect(200)

        // kp2's refresh token must still work
        const stillValid = await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken: user2.refreshToken })
            .expect(200)

        expect(stillValid.body.success).toBe(true)
    })
})

// ── Protected route behaviour under token changes ─────────────────────────────

describe('Protected routes — token ownership and revocation', () => {
    it('access token still works for protected routes after logout (tokens not short-circuited)', async () => {
        /**
         * Access tokens are JWTs: they remain cryptographically valid until
         * they expire even after logout. Logout revokes the *refresh* token
         * from the DB; there is no access-token blocklist by design.
         * This test documents that behaviour so contributors don't regress it.
         */
        const kp = Keypair.random()
        const address = kp.publicKey()
        const { accessToken, refreshToken } = await loginWithWallet(kp)

        // Create a portfolio owned by this user
        await request(app)
            .post('/api/portfolio')
            .send({ userAddress: address, allocations: { XLM: 60, USDC: 40 }, threshold: 5 })

        // Logout
        await request(app)
            .post('/api/auth/logout')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ refreshToken })
            .expect(200)

        // Access token still lets the user reach protected routes in this window
        const portfolioRes = await request(app)
            .get(`/api/user/${address}/portfolios`)
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200)

        expect(portfolioRes.body.success).toBe(true)
    })

    it('returns 401 on protected route with expired access token', async () => {
        const address = Keypair.random().publicKey()
        const expired = jwt.sign(
            { sub: address, type: 'access' },
            TEST_JWT_SECRET,
            { expiresIn: -1 }
        )

        const res = await request(app)
            .get(`/api/user/${address}/portfolios`)
            .set('Authorization', `Bearer ${expired}`)
            .expect(401)

        expect(res.body.error?.code).toBe('UNAUTHORIZED')
    })

    it('returns 401 on protected route with tampered access token', async () => {
        const kp = Keypair.random()
        const { accessToken } = await loginWithWallet(kp)

        // Flip a single character in the signature segment
        const parts = accessToken.split('.')
        parts[2] = parts[2].slice(0, -1) + (parts[2].slice(-1) === 'A' ? 'B' : 'A')
        const tampered = parts.join('.')

        const res = await request(app)
            .get(`/api/user/${kp.publicKey()}/portfolios`)
            .set('Authorization', `Bearer ${tampered}`)
            .expect(401)

        expect(res.body.error?.code).toBe('UNAUTHORIZED')
    })

    it('returns 403 when accessing another users portfolios with a valid token', async () => {
        const owner = Keypair.random()
        const attacker = Keypair.random()
        const { accessToken: attackerToken } = await loginWithWallet(attacker)

        const res = await request(app)
            .get(`/api/user/${owner.publicKey()}/portfolios`)
            .set('Authorization', `Bearer ${attackerToken}`)
            .expect(403)

        expect(res.body.error?.code).toBe('FORBIDDEN')
    })

    it('post-logout-all refresh token cannot be used to obtain a new access token', async () => {
        const kp = Keypair.random()
        const { accessToken, refreshToken } = await loginWithWallet(kp)

        await request(app)
            .post('/api/auth/logout-all')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({})
            .expect(200)

        const refreshAttempt = await request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken })
            .expect(401)

        expect(refreshAttempt.body.error?.code).toBe('UNAUTHORIZED')
    })
})
