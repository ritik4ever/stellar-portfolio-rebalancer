import { describe, it, expect, vi, beforeEach } from 'vitest'
import express, { Express } from 'express'
import request from 'supertest'

const failMock = vi.fn()
const okMock = vi.fn()
const logoutMock = vi.fn()
const verifyAccessTokenMock = vi.fn()

vi.mock('../utils/apiResponse.js', () => ({
    fail: failMock,
    ok: okMock,
}))

vi.mock('../services/authService.js', () => ({
    logout: logoutMock,
    getAuthConfig: () => ({ enabled: true }),
    issueTokens: vi.fn(),
    refreshTokens: vi.fn(),
    verifyAccessToken: verifyAccessTokenMock,
}))

vi.mock('../middleware/requireJwt.js', () => ({
    requireJwt: (req: any, res: any, next: any) => {
        const authHeader = req.headers.authorization
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return failMock(res, 401, 'UNAUTHORIZED', 'Missing or invalid Authorization header')
        }
        const token = authHeader.slice(7)
        if (token === 'invalid-token') {
            return failMock(res, 401, 'UNAUTHORIZED', 'Invalid access token')
        }
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

describe('POST /api/auth/logout-all', () => {
    let app: Express

    beforeEach(async () => {
        failMock.mockReset()
        okMock.mockReset()
        logoutMock.mockReset()
        verifyAccessTokenMock.mockReset()

        // Default: make ok/fail write a real response so supertest doesn't hang
        failMock.mockImplementation((res, status, code, msg) => {
            res.status(status).json({ success: false, error: { code, message: msg } })
        })
        okMock.mockImplementation((res, data) => {
            res.status(200).json({ success: true, data })
        })

        app = await buildApp()
    })

    it('returns 401 when no Authorization header is provided', async () => {
        verifyAccessTokenMock.mockReturnValue(null)

        const res = await request(app)
            .post('/api/auth/logout-all')
            .send({ address: 'GUSER123' })

        expect(res.status).toBe(401)
        expect(logoutMock).not.toHaveBeenCalled()
    })

    it('returns 401 when the Bearer token is invalid', async () => {
        verifyAccessTokenMock.mockReturnValue(null)

        const res = await request(app)
            .post('/api/auth/logout-all')
            .set('Authorization', 'Bearer invalid-token')
            .send({})

        expect(res.status).toBe(401)
        expect(logoutMock).not.toHaveBeenCalled()
    })

    it('logs out the authenticated user and returns 200', async () => {
        const address = 'GOWNER123456789'
        verifyAccessTokenMock.mockReturnValue({ sub: address, type: 'access' })
        logoutMock.mockResolvedValue(true)

        const res = await request(app)
            .post('/api/auth/logout-all')
            .set('Authorization', 'Bearer valid-token')
            .send({})

        expect(res.status).toBe(200)
        expect(logoutMock).toHaveBeenCalledWith(undefined, address)
    })

    it('uses the JWT address, not the body address', async () => {
        const jwtAddress = 'GJWT_ADDRESS_123'
        verifyAccessTokenMock.mockReturnValue({ sub: jwtAddress, type: 'access' })
        logoutMock.mockResolvedValue(true)

        await request(app)
            .post('/api/auth/logout-all')
            .set('Authorization', 'Bearer valid-token')
            .send({}) // no body address

        expect(logoutMock).toHaveBeenCalledWith(undefined, jwtAddress)
    })

    it('returns 403 when body address does not match JWT address', async () => {
        const jwtAddress = 'GOWNER123456789'
        verifyAccessTokenMock.mockReturnValue({ sub: jwtAddress, type: 'access' })

        const res = await request(app)
            .post('/api/auth/logout-all')
            .set('Authorization', 'Bearer valid-token')
            .send({ address: 'GDIFFERENT_ADDRESS' })

        expect(res.status).toBe(403)
        expect(logoutMock).not.toHaveBeenCalled()
    })

    it('accepts a matching body address and logs out successfully', async () => {
        const address = 'GOWNER123456789'
        verifyAccessTokenMock.mockReturnValue({ sub: address, type: 'access' })
        logoutMock.mockResolvedValue(true)

        const res = await request(app)
            .post('/api/auth/logout-all')
            .set('Authorization', 'Bearer valid-token')
            .send({ address })

        expect(res.status).toBe(200)
        expect(logoutMock).toHaveBeenCalledWith(undefined, address)
    })
})
