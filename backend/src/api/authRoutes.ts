import { Router, Request, Response } from 'express'
import {
    getAuthConfig,
    issueTokens,
    refreshTokens,
    logout,
    issueChallenge,
    verifyWalletSignature
} from '../services/authService.js'
import { requireJwt } from '../middleware/requireJwt.js'
import { authRateLimiter } from '../middleware/rateLimit.js'
import { validateRequest } from '../middleware/validate.js'
import { loginSchema, refreshTokenSchema } from './validation.js'
import { ok, fail } from '../utils/apiResponse.js'
import { getErrorMessage } from '../utils/helpers.js'

const router = Router()

/**
 * Issue a one-time challenge nonce that the client must sign with their
 * Stellar wallet private key.
 *
 * POST /api/auth/challenge
 * Body: { address: string }
 * Response: { challenge: string }  — sign this exact string (UTF-8) with the wallet
 */
router.post('/challenge', authRateLimiter, async (req: Request, res: Response) => {
    try {
        const config = getAuthConfig()
        if (!config.enabled) {
            return fail(res, 503, 'SERVICE_UNAVAILABLE', 'JWT auth not configured (set JWT_SECRET)')
        }
        const address = req.body?.address
        if (!address || typeof address !== 'string' || !address.trim()) {
            return fail(res, 400, 'VALIDATION_ERROR', 'address is required')
        }
        const challenge = issueChallenge(address.trim())
        return ok(res, { challenge })
    } catch (error) {
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

/**
 * Complete wallet-signed challenge authentication and receive JWT tokens.
 *
 * POST /api/auth/login
 * Body: { address: string, signature: string }
 *   address   — Stellar public key (G…)
 *   signature — base64-encoded Ed25519 signature over the challenge string
 *               returned by POST /api/auth/challenge
 */
router.post('/login', authRateLimiter, async (req: Request, res: Response) => {
    try {
        const config = getAuthConfig()
        if (!config.enabled) {
            return fail(res, 503, 'SERVICE_UNAVAILABLE', 'JWT auth not configured (set JWT_SECRET)')
        }
        const address = req.body?.address
        const signature = req.body?.signature
        if (!address || typeof address !== 'string' || !address.trim()) {
            return fail(res, 400, 'VALIDATION_ERROR', 'address is required')
        }
        if (!signature || typeof signature !== 'string' || !signature.trim()) {
            return fail(res, 400, 'VALIDATION_ERROR', 'signature is required — request a challenge first via POST /auth/challenge')
        }
        const trimmed = address.trim()
        const valid = verifyWalletSignature(trimmed, signature.trim())
        if (!valid) {
            return fail(res, 401, 'UNAUTHORIZED', 'Invalid or expired signature — request a new challenge and sign it with your wallet')
        }
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
