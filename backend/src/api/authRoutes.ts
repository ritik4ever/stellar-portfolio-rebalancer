import { Router, Request, Response } from 'express'
import {
    getAuthConfig,
    issueTokens,
    refreshTokens,
    logout
} from '../services/authService.js'
import { requireJwt } from '../middleware/requireJwt.js'
import { ok, fail } from '../utils/apiResponse.js'
import { getErrorMessage } from '../utils/helpers.js'

const router = Router()

router.post('/login', async (req: Request, res: Response) => {
    try {
        const config = getAuthConfig()
        if (!config.enabled) {
            return fail(res, 503, 'SERVICE_UNAVAILABLE', 'JWT auth not configured (set JWT_SECRET)')
        }
        const address = req.body?.address
        if (!address || typeof address !== 'string' || !address.trim()) {
            return fail(res, 400, 'VALIDATION_ERROR', 'address is required')
        }
        const trimmed = address.trim()
        const tokens = await issueTokens(trimmed)
        return ok(res, {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresIn: tokens.expiresIn,
            refreshExpiresIn: tokens.refreshExpiresIn
        })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

router.post('/refresh', async (req: Request, res: Response) => {
    try {
        const config = getAuthConfig()
        if (!config.enabled) {
            return fail(res, 503, 'SERVICE_UNAVAILABLE', 'JWT auth not configured')
        }
        const refreshToken = req.body?.refreshToken
        if (!refreshToken || typeof refreshToken !== 'string') {
            return fail(res, 400, 'VALIDATION_ERROR', 'refreshToken is required')
        }
        const tokens = await refreshTokens(refreshToken)
        if (!tokens) {
            return fail(res, 401, 'UNAUTHORIZED', 'Invalid or expired refresh token')
        }
        return ok(res, {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresIn: tokens.expiresIn,
            refreshExpiresIn: tokens.refreshExpiresIn
        })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

router.post('/logout', requireJwt, async (req: Request, res: Response) => {
    try {
        const refreshToken = req.body?.refreshToken
        const address = req.user?.address
        await logout(refreshToken, address)
        return ok(res, { message: 'Logged out' })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

router.post('/logout-all', async (req: Request, res: Response) => {
    try {
        const address = req.body?.address
        if (!address || typeof address !== 'string') {
            return fail(res, 400, 'VALIDATION_ERROR', 'address is required')
        }
        await logout(undefined, address.trim())
        return ok(res, { message: 'Logged out' })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

export const authRouter = router
