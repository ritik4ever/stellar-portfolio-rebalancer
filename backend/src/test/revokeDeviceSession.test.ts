import { describe, it, expect, vi, beforeEach } from 'vitest'
import express, { Express } from 'express'
import request from 'supertest'

const failMock = vi.fn()
const okMock = vi.fn()
const revokeDeviceSessionMock = vi.fn()
const verifyAccessTokenMock = vi.fn()

vi.mock('../utils/apiResponse.js', () => ({
    fail: failMock,
    ok: okMock,
}))

vi.mock('../services/authService.js', () => ({
    revokeDeviceSession: revokeDeviceSessionMock,
    getAuthConfig: () => ({ enabled: true }),
    issueTokens: vi.fn(),
    refreshTokens: vi.fn(),
    logout: vi.fn(),
    issueChallenge: vi.fn(),
    verifyWalletSignature: vi.fn(),
    verifyAccessToken: verifyAccessTokenMock,
}))

vi.mock('../middleware/requireJwt.js', () => ({
    requireJwt: (req: any, res: any, next: any) => {
        const authHeader = req.headers.authorization
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return failMock(res, 401, 'UNAUTHORIZED', 'Missing or invalid Authorization header')
        }
        const token = authHeader.slice(7)
        const decoded = verifyAccessTokenMock(token)
        if (!decoded) {
            return failMock(res, 401, 'UNAUTHORIZED', 'Invalid access token')
        }
        req.user = { address: decoded.sub }
        next()
    }
}))

async function buildApp(): Promise<Express> {
    vi.resetModules()
    const { authRouter } = await import('../api/authRoutes.js')
    const app = express()
    app.use(express.json())
    app.use('/api/auth', authRouter)
    return app
}

describe('DELETE /api/auth/sessions/:tokenId', () => {
    let app: Express
    const USER = 'GOWNER123456789'
    const TOKEN_ID = 'token-abc-123'

    beforeEach(async () => {
        failMock.mockReset()
        okMock.mockReset()
        revokeDeviceSessionMock.mockReset()
        verifyAccessTokenMock.mockReset()

        failMock.mockImplementation((res, status, code, msg) => {
            res.status(status).json({ success: false, error: { code, message: msg } })
        })
        okMock.mockImplementation((res, data) => {
            res.status(200).json({ success: true, data })
        })

        app = await buildApp()
    })

    it('returns 401 when no Authorization header is provided', async () => {
        const res = await request(app).delete(`/api/auth/sessions/${TOKEN_ID}`)
        expect(res.status).toBe(401)
        expect(revokeDeviceSessionMock).not.toHaveBeenCalled()
    })

    it('revokes the session and returns 200 on success', async () => {
        verifyAccessTokenMock.mockReturnValue({ sub: USER, type: 'access' })
        revokeDeviceSessionMock.mockResolvedValue({ success: true })

        const res = await request(app)
            .delete(`/api/auth/sessions/${TOKEN_ID}`)
            .set('Authorization', 'Bearer valid-token')

        expect(res.status).toBe(200)
        expect(revokeDeviceSessionMock).toHaveBeenCalledWith(USER, TOKEN_ID)
    })

    it('returns 404 when tokenId does not exist', async () => {
        verifyAccessTokenMock.mockReturnValue({ sub: USER, type: 'access' })
        revokeDeviceSessionMock.mockResolvedValue({ success: false, reason: 'not_found' })

        const res = await request(app)
            .delete(`/api/auth/sessions/${TOKEN_ID}`)
            .set('Authorization', 'Bearer valid-token')

        expect(res.status).toBe(404)
        expect(revokeDeviceSessionMock).toHaveBeenCalledWith(USER, TOKEN_ID)
    })

    it('returns 403 when tokenId belongs to a different user', async () => {
        verifyAccessTokenMock.mockReturnValue({ sub: USER, type: 'access' })
        revokeDeviceSessionMock.mockResolvedValue({ success: false, reason: 'forbidden' })

        const res = await request(app)
            .delete(`/api/auth/sessions/${TOKEN_ID}`)
            .set('Authorization', 'Bearer valid-token')

        expect(res.status).toBe(403)
        expect(revokeDeviceSessionMock).toHaveBeenCalledWith(USER, TOKEN_ID)
    })

    it('does not affect other sessions when revoking one', async () => {
        verifyAccessTokenMock.mockReturnValue({ sub: USER, type: 'access' })
        revokeDeviceSessionMock.mockResolvedValue({ success: true })

        await request(app)
            .delete(`/api/auth/sessions/${TOKEN_ID}`)
            .set('Authorization', 'Bearer valid-token')

        // Only called once with the specific tokenId — other sessions untouched
        expect(revokeDeviceSessionMock).toHaveBeenCalledTimes(1)
        expect(revokeDeviceSessionMock).toHaveBeenCalledWith(USER, TOKEN_ID)
    })
})
