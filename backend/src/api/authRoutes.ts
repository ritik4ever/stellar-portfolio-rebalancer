import { Router, Request, Response } from 'express'
import {
    getAuthConfig,
    issueTokens,
    refreshTokens,
    logout
} from '../services/authService.js'
import { requireJwt } from '../middleware/requireJwt.js'
import { authRateLimiter } from '../middleware/rateLimit.js'
import { validateRequest } from '../middleware/validate.js'
import { loginSchema, refreshTokenSchema } from './validation.js'
import { ok, fail } from '../utils/apiResponse.js'
import { getErrorMessage } from '../utils/helpers.js'

const router = Router()

router.post('/login', authRateLimiter, validateRequest(loginSchema), async (req: Request, res: Response) => {
    try {
        const config = getAuthConfig()
        if (!config.enabled) {
            return fail(res, 503, 'SERVICE_UNAVAILABLE', 'JWT auth not configured (set JWT_SECRET)')
        }
        const { address } = req.body
        const tokens = await issueTokens(address)
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

router.post('/refresh', authRateLimiter, validateRequest(refreshTokenSchema), async (req: Request, res: Response) => {
    try {
        const config = getAuthConfig()
        if (!config.enabled) {
            return fail(res, 503, 'SERVICE_UNAVAILABLE', 'JWT auth not configured')
        }
        const { refreshToken } = req.body
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

router.post('/logout-all', requireJwt, async (req: Request, res: Response) => {
    try {
        const address = req.user!.address
        const bodyAddress = req.body?.address
        if (bodyAddress && typeof bodyAddress === 'string' && bodyAddress.trim() !== address) {
            return fail(res, 403, 'FORBIDDEN', 'Address mismatch')
        }
        await logout(undefined, address)
        return ok(res, { message: 'Logged out' })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

export const authRouter = router
