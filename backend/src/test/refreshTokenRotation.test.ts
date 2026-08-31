/**
 * Refresh-token rotation, reuse detection, and family revocation (#1406).
 *
 * Runs against the in-memory token store (no DATABASE_URL configured), which is
 * the same code path the Postgres implementation mirrors.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import jwt from 'jsonwebtoken'

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    logAudit: vi.fn(),
}))

vi.mock('../observability/metrics.js', () => ({
    recordAuthSecurityEvent: vi.fn(),
}))

// In-memory revocation list — the real one reaches for Redis.
const revokedTokens = new Set<string>()
const revokedUsers = new Set<string>()

vi.mock('../services/tokenRevocation.js', () => ({
    tokenRevocationService: {
        addRevokedToken: vi.fn(async (hash: string) => { revokedTokens.add(hash) }),
        isRevoked: vi.fn(async (hash: string) => revokedTokens.has(hash)),
        revokeAllForUser: vi.fn(async (user: string) => { revokedUsers.add(user) }),
        isUserRevoked: vi.fn(async (user: string) => revokedUsers.has(user)),
    },
}))

vi.mock('../db/client.js', () => ({
    isDbConfigured: () => false,
    getPool: () => {
        throw new Error('Postgres should not be used in this test')
    },
    query: vi.fn(),
}))

const USER = 'GTESTUSERADDRESSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const OTHER_USER = 'GOTHERUSERADDRESSBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const ORIGINAL_ENV = { ...process.env }

async function loadAuth() {
    return import('../services/authService.js')
}

async function loadDb() {
    return import('../db/refreshTokenDb.js')
}

describe('refresh token rotation (#1406)', () => {
    beforeEach(async () => {
        process.env.JWT_SECRET = 'a'.repeat(48)
        process.env.JWT_ACCESS_EXPIRY_SEC = '900'
        process.env.JWT_REFRESH_EXPIRY_SEC = '604800'
        revokedTokens.clear()
        revokedUsers.clear()
        const db = await loadDb()
        db.resetRefreshTokenFamilyStoreForTests()
    })

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV }
        vi.clearAllMocks()
    })

    describe('normal rotation', () => {
        it('issues a new refresh token on every refresh', async () => {
            const { issueTokens, refreshTokens } = await loadAuth()

            const first = await issueTokens(USER)
            const second = await refreshTokens(first.refreshToken)

            expect(second).not.toBeNull()
            expect(second!.refreshToken).not.toBe(first.refreshToken)
            expect(second!.accessToken).toBeTruthy()
        })

        it('keeps the rotated token inside the same family and bumps the generation', async () => {
            const { issueTokens, refreshTokens } = await loadAuth()
            const { findRefreshToken } = await loadDb()

            const first = await issueTokens(USER)
            const firstRow = await findRefreshToken(first.refreshToken)
            expect(firstRow?.generation).toBe(0)

            const second = await refreshTokens(first.refreshToken)
            const secondRow = await findRefreshToken(second!.refreshToken)

            expect(secondRow?.family_id).toBe(firstRow?.family_id)
            expect(secondRow?.generation).toBe(1)

            const third = await refreshTokens(second!.refreshToken)
            const thirdRow = await findRefreshToken(third!.refreshToken)
            expect(thirdRow?.family_id).toBe(firstRow?.family_id)
            expect(thirdRow?.generation).toBe(2)
        })

        it('makes each refresh token single-use — the old one stops working', async () => {
            const { issueTokens, refreshTokens } = await loadAuth()
            const { findRefreshToken } = await loadDb()

            const first = await issueTokens(USER)
            await refreshTokens(first.refreshToken)

            expect(await findRefreshToken(first.refreshToken)).toBeNull()
        })

        it('carries refresh-token metadata across a rotation', async () => {
            const { issueTokens, refreshTokens } = await loadAuth()
            const { findRefreshToken } = await loadDb()

            const first = await issueTokens(USER, { userAgent: 'vitest', ip: '127.0.0.1' } as any)
            const second = await refreshTokens(first.refreshToken)
            const row = await findRefreshToken(second!.refreshToken)

            expect(row?.metadata).toMatchObject({ userAgent: 'vitest' })
            expect(row?.metadata?.lastUsedAt).toBeTruthy()
        })

        it('gives separate logins separate families', async () => {
            const { issueTokens } = await loadAuth()
            const { findRefreshToken } = await loadDb()

            const a = await issueTokens(USER)
            const b = await issueTokens(USER)

            const rowA = await findRefreshToken(a.refreshToken)
            const rowB = await findRefreshToken(b.refreshToken)

            expect(rowA?.family_id).toBeTruthy()
            expect(rowB?.family_id).toBeTruthy()
            expect(rowA?.family_id).not.toBe(rowB?.family_id)
        })
    })

    describe('reuse detection and family revocation', () => {
        it('rejects a replayed refresh token', async () => {
            const { issueTokens, refreshTokens } = await loadAuth()

            const first = await issueTokens(USER)
            await refreshTokens(first.refreshToken)

            expect(await refreshTokens(first.refreshToken)).toBeNull()
        })

        it('revokes the whole family when a rotated-out token is replayed', async () => {
            const { issueTokens, refreshTokens } = await loadAuth()
            const { findRefreshToken, getRefreshTokenFamily } = await loadDb()

            const gen0 = await issueTokens(USER)
            const gen1 = await refreshTokens(gen0.refreshToken)
            const gen2 = await refreshTokens(gen1!.refreshToken)
            const familyId = (await findRefreshToken(gen2!.refreshToken))!.family_id!

            // Replay an old generation.
            await refreshTokens(gen1!.refreshToken)

            const family = await getRefreshTokenFamily(familyId)
            expect(family?.revoked).toBe(true)
            expect(family?.revoked_reason).toBe('reused_rotated_token')

            // The current, otherwise-valid token is destroyed too.
            expect(await findRefreshToken(gen2!.refreshToken)).toBeNull()
            expect(await refreshTokens(gen2!.refreshToken)).toBeNull()
        })

        it('leaves other families — the user\'s other devices — untouched', async () => {
            const { issueTokens, refreshTokens } = await loadAuth()
            const { findRefreshToken, getRefreshTokenFamily } = await loadDb()

            const deviceA0 = await issueTokens(USER)
            const deviceB0 = await issueTokens(USER)
            const deviceA1 = await refreshTokens(deviceA0.refreshToken)
            const familyB = (await findRefreshToken(deviceB0.refreshToken))!.family_id!

            // Compromise device A only.
            await refreshTokens(deviceA0.refreshToken)

            expect(await findRefreshToken(deviceA1!.refreshToken)).toBeNull()
            expect(await findRefreshToken(deviceB0.refreshToken)).not.toBeNull()
            expect((await getRefreshTokenFamily(familyB))?.revoked).toBe(false)

            // Device B can still rotate normally.
            expect(await refreshTokens(deviceB0.refreshToken)).not.toBeNull()
        })

        it('does not touch another user\'s sessions', async () => {
            const { issueTokens, refreshTokens } = await loadAuth()
            const { findRefreshToken } = await loadDb()

            const victim = await issueTokens(USER)
            const bystander = await issueTokens(OTHER_USER)
            await refreshTokens(victim.refreshToken)
            await refreshTokens(victim.refreshToken) // replay

            expect(await findRefreshToken(bystander.refreshToken)).not.toBeNull()
        })

        it('records an audit event naming the family and replayed generation', async () => {
            const { issueTokens, refreshTokens, getRecentAuthAuditEvents } = await loadAuth()

            const gen0 = await issueTokens(USER)
            const gen1 = await refreshTokens(gen0.refreshToken)
            await refreshTokens(gen0.refreshToken) // replay generation 0

            const revocation = getRecentAuthAuditEvents(20).find(
                (e) => e.action === 'revocation' && e.details?.reason === 'reused_rotated_token',
            )

            expect(revocation).toBeDefined()
            expect(revocation!.userAddress).toBe(USER)
            expect(revocation!.details).toMatchObject({ replayedGeneration: 0 })
            expect(gen1).not.toBeNull()
        })

        it('refuses a live token whose family was already revoked', async () => {
            const { issueTokens, refreshTokens } = await loadAuth()
            const { findRefreshToken, revokeRefreshTokenFamily, createRefreshToken, generateRefreshTokenId } = await loadDb()

            const tokens = await issueTokens(USER)
            const row = (await findRefreshToken(tokens.refreshToken))!

            // Revoke the family but re-add a live token to it, simulating a race
            // where a token outlives the revocation sweep.
            await revokeRefreshTokenFamily(row.family_id!, 'reused_rotated_token')
            await createRefreshToken(
                generateRefreshTokenId(),
                USER,
                tokens.refreshToken,
                new Date(Date.now() + 60_000),
                null,
                { familyId: row.family_id!, generation: 5 },
            )

            expect(await refreshTokens(tokens.refreshToken)).toBeNull()
        })
    })

    describe('validation', () => {
        it('rejects an access token presented as a refresh token', async () => {
            const { issueTokens, refreshTokens } = await loadAuth()
            const tokens = await issueTokens(USER)

            expect(await refreshTokens(tokens.accessToken)).toBeNull()
        })

        it('rejects an unknown token without revoking anything', async () => {
            const { issueTokens, refreshTokens } = await loadAuth()
            const { findRefreshToken } = await loadDb()

            const live = await issueTokens(USER)
            const stranger = jwt.sign(
                { sub: USER, type: 'refresh', jti: 'nope' },
                process.env.JWT_SECRET!,
                { expiresIn: 3600 },
            )

            expect(await refreshTokens(stranger)).toBeNull()
            expect(await findRefreshToken(live.refreshToken)).not.toBeNull()
        })
    })

    describe('rotation bookkeeping', () => {
        it('prunes rotation records once the underlying token has expired', async () => {
            const { recordRotatedRefreshToken, findRotatedRefreshToken, pruneExpiredRotations } = await loadDb()

            await recordRotatedRefreshToken('expired-token', 'fam-1', 0, new Date(Date.now() - 1000))
            await recordRotatedRefreshToken('live-token', 'fam-1', 1, new Date(Date.now() + 60_000))

            const pruned = await pruneExpiredRotations()

            expect(pruned).toBe(1)
            expect(await findRotatedRefreshToken('expired-token')).toBeNull()
            expect(await findRotatedRefreshToken('live-token')).not.toBeNull()
        })
    })
})
