import { Router, Request, Response } from 'express'
import { databaseService } from '../services/databaseService.js'
import { ok, fail } from '../utils/apiResponse.js'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import { consentStatusQuerySchema, recordConsentSchema } from './validation.js'
import { validateRequest, validateQuery } from '../middleware/validate.js'
import { protectedWriteLimiter, protectedCriticalLimiter } from '../middleware/rateLimit.js'
import { idempotencyMiddleware } from '../middleware/idempotency.js'
import { requireJwtWhenEnabled } from '../middleware/requireJwt.js'

export const consentRouter = Router()

/** Get consent status for a user. Required before using the app. */
consentRouter.get('/consent/status', validateQuery(consentStatusQuerySchema), (req: Request, res: Response) => {
    try {
        const userId = (req.query.userId ?? req.query.user_id) as string
        const consent = databaseService.getConsent(userId)
        const accepted = databaseService.hasFullConsent(userId)
        return ok(res, {
            accepted,
            termsAcceptedAt: consent?.termsAcceptedAt ?? null,
            privacyAcceptedAt: consent?.privacyAcceptedAt ?? null,
            cookieAcceptedAt: consent?.cookieAcceptedAt ?? null
        })
    } catch (error) {
        logger.error('[ERROR] Consent status failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

/** Record user acceptance of ToS, Privacy Policy, Cookie Policy. */
consentRouter.post('/consent', ...protectedWriteLimiter, idempotencyMiddleware, validateRequest(recordConsentSchema), (req: Request, res: Response) => {
    try {
        const { userId, terms, privacy, cookies } = req.body
        const ipAddress = req.ip ?? req.socket?.remoteAddress
        const userAgent = req.get('user-agent')
        databaseService.recordConsent(userId, { terms, privacy, cookies, ipAddress, userAgent })
        return ok(res, { message: 'Consent recorded', accepted: true })
    } catch (error) {
        logger.error('[ERROR] Record consent failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

/** GDPR: Delete all data for a user (portfolios, history, consent). Requires JWT when enabled. */
consentRouter.delete('/user/:address/data', requireJwtWhenEnabled, ...protectedCriticalLimiter, async (req: Request, res: Response) => {
    try {
        const address = req.params.address
        const userId = req.user?.address ?? address
        if (userId !== address) return fail(res, 403, 'FORBIDDEN', 'You can only delete your own data')
        if (!address) return fail(res, 400, 'VALIDATION_ERROR', 'address is required')
        try {
            const { deleteAllRefreshTokensForUser } = await import('../db/refreshTokenDb.js')
            if (typeof deleteAllRefreshTokensForUser === 'function') {
                await deleteAllRefreshTokensForUser(userId)
            }
        } catch (_) { /* refresh token DB optional */ }
        databaseService.deleteUserData(userId)
        return ok(res, { message: 'Your data has been deleted' })
    } catch (error) {
        logger.error('[ERROR] Delete user data failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

