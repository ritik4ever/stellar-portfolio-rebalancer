import { Router, Request, Response } from 'express'
import { databaseService } from '../services/databaseService.js'
import { ok, fail } from '../utils/apiResponse.js'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import {
    consentAuditQuerySchema,
    consentGrantSchema,
    consentStatusQuerySchema,
    consentRevokeSchema,
    recordConsentSchema
} from './validation.js'
import { validateRequest, validateQuery } from '../middleware/validate.js'
import { protectedWriteLimiter, protectedCriticalLimiter } from '../middleware/rateLimit.js'
import { idempotencyMiddleware } from '../middleware/idempotency.js'
import { requireJwtWhenEnabled } from '../middleware/requireJwt.js'

export const consentRouter = Router()

function consentRequestMeta(req: Request): { ipAddress?: string; userAgent?: string } {
    return {
        ipAddress: req.ip ?? req.socket?.remoteAddress,
        userAgent: req.get('user-agent')
    }
}

function resolveConsentUserId(req: Request, candidate?: string): string | undefined {
    return req.user?.address ?? candidate
}

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
            cookieAcceptedAt: consent?.cookieAcceptedAt ?? null,
            revokedAt: consent?.revokedAt ?? null,
            active: consent?.active ?? false
        })
    } catch (error) {
        logger.error('[ERROR] Consent status failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

/** GDPR: Grant active consent and append an immutable audit event. */
consentRouter.post('/consent/grant', requireJwtWhenEnabled, ...protectedWriteLimiter, idempotencyMiddleware, validateRequest(consentGrantSchema), (req: Request, res: Response) => {
    try {
        const userId = resolveConsentUserId(req, req.body.userId)
        if (!userId) return fail(res, 400, 'VALIDATION_ERROR', 'userId is required')
        const meta = consentRequestMeta(req)
        databaseService.recordConsent(userId, {
            terms: req.body.terms,
            privacy: req.body.privacy,
            cookies: req.body.cookies,
            ...meta
        })
        const consent = databaseService.getConsent(userId)
        return ok(res, {
            message: 'Consent granted',
            accepted: databaseService.hasFullConsent(userId),
            userId,
            termsAcceptedAt: consent?.termsAcceptedAt ?? null,
            privacyAcceptedAt: consent?.privacyAcceptedAt ?? null,
            cookieAcceptedAt: consent?.cookieAcceptedAt ?? null,
            revokedAt: consent?.revokedAt ?? null,
            active: consent?.active ?? false,
            ipAddress: meta.ipAddress ?? null
        })
    } catch (error) {
        logger.error('[ERROR] Grant consent failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

/** GDPR: Revoke active consent and append an immutable audit event. */
consentRouter.post('/consent/revoke', requireJwtWhenEnabled, ...protectedCriticalLimiter, idempotencyMiddleware, validateRequest(consentRevokeSchema), (req: Request, res: Response) => {
    try {
        const userId = resolveConsentUserId(req, req.body.userId)
        if (!userId) return fail(res, 400, 'VALIDATION_ERROR', 'userId is required')
        const meta = consentRequestMeta(req)
        databaseService.revokeConsent(userId, meta)
        const consent = databaseService.getConsent(userId)
        return ok(res, {
            message: 'Consent revoked',
            accepted: false,
            userId,
            revokedAt: consent?.revokedAt ?? null,
            active: consent?.active ?? false
        })
    } catch (error) {
        logger.error('[ERROR] Revoke consent failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

/** GDPR: Return append-only grant/revoke audit events for a user. */
consentRouter.get('/consent/audit', requireJwtWhenEnabled, validateQuery(consentAuditQuerySchema), (req: Request, res: Response) => {
    try {
        const userId = resolveConsentUserId(req, (req.query.userId ?? req.query.user_id) as string | undefined)
        if (!userId) return fail(res, 400, 'VALIDATION_ERROR', 'userId is required')
        return ok(res, {
            userId,
            events: databaseService.getConsentAudit(userId)
        })
    } catch (error) {
        logger.error('[ERROR] Consent audit failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

/** Record user acceptance of ToS, Privacy Policy, Cookie Policy. */
consentRouter.post('/consent', ...protectedWriteLimiter, idempotencyMiddleware, validateRequest(recordConsentSchema), (req: Request, res: Response) => {
    try {
        const { userId, terms, privacy, cookies } = req.body
        databaseService.recordConsent(userId, { terms, privacy, cookies, ...consentRequestMeta(req) })
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
