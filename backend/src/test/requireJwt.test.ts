import express from 'express'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireJwt } from '../middleware/requireJwt.js'

const CURRENT_SECRET = 'c'.repeat(32)
const PREVIOUS_SECRET = 'p'.repeat(32)

function createApp() {
    const app = express()
    app.get('/protected', requireJwt, (req, res) => {
        res.status(200).json({
            ok: true,
            user: req.user ?? null,
        })
    })
    return app
}

describe('requireJwt middleware', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
        vi.stubEnv('JWT_SECRET', CURRENT_SECRET)
        vi.stubEnv('JWT_PREVIOUS_SECRET', '')
        vi.stubEnv('JWT_PREVIOUS_SECRET_GRACE_UNTIL', '')
        vi.stubEnv('JWT_CLOCK_SKEW_SEC', '30')
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllEnvs()
    })

    it('passes valid token and attaches user to request context', async () => {
        const token = jwt.sign({ sub: 'GVALID123', type: 'access' }, CURRENT_SECRET, { expiresIn: '15m' })
        const app = createApp()

        const res = await request(app)
            .get('/protected')
            .set('Authorization', `Bearer ${token}`)
            .expect(200)

        expect(res.body.ok).toBe(true)
        expect(res.body.user).toEqual({ address: 'GVALID123' })
    })

    it('returns 401 with TOKEN_EXPIRED for expired token', async () => {
        const token = jwt.sign({ sub: 'GEXPIRED', type: 'access' }, CURRENT_SECRET, { expiresIn: -31 })
        const app = createApp()

        const res = await request(app)
            .get('/protected')
            .set('Authorization', `Bearer ${token}`)
            .expect(401)

        expect(res.body.error?.code).toBe('TOKEN_EXPIRED')
    })

    it('accepts an access token that expired within the configured clock skew', async () => {
        const token = jwt.sign({ sub: 'GSKEWEXP', type: 'access' }, CURRENT_SECRET, { expiresIn: -10 })
        const app = createApp()

        const res = await request(app)
            .get('/protected')
            .set('Authorization', `Bearer ${token}`)
            .expect(200)

        expect(res.body.user).toEqual({ address: 'GSKEWEXP' })
    })

    it('accepts an access token issued slightly in the future within the configured clock skew', async () => {
        const nowSec = Math.floor(Date.now() / 1000)
        const token = jwt.sign(
            { sub: 'GSKEWIAT', type: 'access', iat: nowSec + 10, exp: nowSec + 900 },
            CURRENT_SECRET
        )
        const app = createApp()

        const res = await request(app)
            .get('/protected')
            .set('Authorization', `Bearer ${token}`)
            .expect(200)

        expect(res.body.user).toEqual({ address: 'GSKEWIAT' })
    })

    it('rejects an access token issued beyond the configured clock skew', async () => {
        const nowSec = Math.floor(Date.now() / 1000)
        const token = jwt.sign(
            { sub: 'GFUTUREIAT', type: 'access', iat: nowSec + 31, exp: nowSec + 900 },
            CURRENT_SECRET
        )
        const app = createApp()

        const res = await request(app)
            .get('/protected')
            .set('Authorization', `Bearer ${token}`)
            .expect(401)

        expect(res.body.error?.code).toBe('UNAUTHORIZED')
    })

    it('returns 401 for malformed token input', async () => {
        const app = createApp()
        const malformed = 'not-base64-token'
        const res = await request(app)
            .get('/protected')
            .set('Authorization', `Bearer ${malformed}`)
            .expect(401)

        expect(res.body.error?.code).toBe('UNAUTHORIZED')
    })

    it('returns 401 for token signed with wrong secret', async () => {
        const wrongSecretToken = jwt.sign({ sub: 'GWRONG', type: 'access' }, 'w'.repeat(32), { expiresIn: '15m' })
        const app = createApp()

        const res = await request(app)
            .get('/protected')
            .set('Authorization', `Bearer ${wrongSecretToken}`)
            .expect(401)

        expect(res.body.error?.code).toBe('UNAUTHORIZED')
    })

    it('returns 401 for missing Authorization header', async () => {
        const app = createApp()

        const res = await request(app)
            .get('/protected')
            .expect(401)

        expect(res.body.error?.code).toBe('UNAUTHORIZED')
    })

    it('accepts tokens signed with previous secret within grace period', async () => {
        vi.stubEnv('JWT_PREVIOUS_SECRET', PREVIOUS_SECRET)
        vi.stubEnv('JWT_PREVIOUS_SECRET_GRACE_UNTIL', '2026-01-01T01:00:00.000Z')
        const oldToken = jwt.sign({ sub: 'GOLDSECRET', type: 'access' }, PREVIOUS_SECRET, { expiresIn: '15m' })
        const app = createApp()

        const res = await request(app)
            .get('/protected')
            .set('Authorization', `Bearer ${oldToken}`)
            .expect(200)

        expect(res.body.user).toEqual({ address: 'GOLDSECRET' })
    })

    it('rejects tokens signed with previous secret after grace period', async () => {
        vi.stubEnv('JWT_PREVIOUS_SECRET', PREVIOUS_SECRET)
        vi.stubEnv('JWT_PREVIOUS_SECRET_GRACE_UNTIL', '2025-12-31T23:59:59.000Z')
        const oldToken = jwt.sign({ sub: 'GOLDREJECTED', type: 'access' }, PREVIOUS_SECRET, { expiresIn: '15m' })
        const app = createApp()

        const res = await request(app)
            .get('/protected')
            .set('Authorization', `Bearer ${oldToken}`)
            .expect(401)

        expect(res.body.error?.code).toBe('UNAUTHORIZED')
    })
})
