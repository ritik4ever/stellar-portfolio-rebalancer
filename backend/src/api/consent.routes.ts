import { Router, Request, Response } from 'express'
import { databaseService } from '../services/databaseService.js'
import { ok, fail } from '../utils/apiResponse.js'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import {
    consentAuditQuerySchema,
    consentExportQuerySchema,
    consentGrantSchema,
    consentStatusQuerySchema,
    consentRevokeSchema,
    recordConsentSchema
} from './validation.js'
import { validateRequest, validateQuery } from '../middleware/validate.js'
import { protectedWriteLimiter, protectedCriticalLimiter } from '../middleware/rateLimit.js'
import { idempotencyMiddleware } from '../middleware/idempotency.js'
import { requireJwtWhenEnabled } from '../middleware/requireJwt.js'
import { getAuthConfig } from '../services/authService.js'
import { getConsentPolicyVersions } from '../config/consentPolicyConfig.js'
import {
    buildConsentHistoryExport,
    formatConsentHistoryCsv
} from '../services/consentExportService.js'

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

function resolveConsentAccess(
    req: Request,
    candidate?: string
): { ok: true; userId: string } | { ok: false; status: number; code: string; message: string } {
    const authConfig = getAuthConfig()
    if (authConfig.enabled) {
        const tokenSubject = req.user?.address
        if (!tokenSubject) {
            return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Authentication required' }
        }
        if (candidate && candidate !== tokenSubject) {
            return {
                ok: false,
                status: 403,
                code: 'FORBIDDEN',
                message: 'Cannot access consent data for another user'
            }
        }
        return { ok: true, userId: tokenSubject }
    }

    const userId = resolveConsentUserId(req, candidate)
    if (!userId) {
        return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: 'userId is required' }
    }
    return { ok: true, userId }
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
            policyVersions: consent?.policyVersions ?? getConsentPolicyVersions(),
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
        const access = resolveConsentAccess(
            req,
            (req.query.userId ?? req.query.user_id) as string | undefined
        )
        if (!access.ok) {
            return fail(res, access.status, access.code, access.message)
        }

        logger.info('[CONSENT] Consent audit read', { userId: access.userId })
        return ok(res, {
            userId: access.userId,
            events: databaseService.getConsentAudit(access.userId)
        })
    } catch (error) {
        logger.error('[ERROR] Consent audit failed', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

/** GDPR: Export consent snapshot and grant/revoke history (JSON or CSV). */
consentRouter.get('/consent/export', requireJwtWhenEnabled, validateQuery(consentExportQuerySchema), (req: Request, res: Response) => {
    try {
        const access = resolveConsentAccess(
            req,
            (req.query.userId ?? req.query.user_id) as string | undefined
        )
        if (!access.ok) {
            return fail(res, access.status, access.code, access.message)
        }

        const format = (req.query.format as string | undefined) ?? 'json'
        const exportData = buildConsentHistoryExport(access.userId)

        logger.info('[CONSENT] Consent history export', {
            userId: access.userId,
            format,
            historyCount: exportData.history.length,
            hasCurrentSnapshot: exportData.current !== null
        })

        if (format === 'csv') {
            const csv = formatConsentHistoryCsv(exportData)
            res.setHeader('Content-Type', 'text/csv; charset=utf-8')
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="consent-history-${access.userId}.csv"`
            )
            return res.status(200).send(csv)
        }

        return ok(res, { export: exportData })
    } catch (error) {
        logger.error('[ERROR] Consent export failed', { error: getErrorObject(error) })
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

/** GDPR: Purge consent audit events older than the configured retention period. */
consentRouter.post('/consent/audit/purge', requireJwtWhenEnabled, ...protectedCriticalLimiter, (req: Request, res: Response) => {
    try {
        const retentionRaw =
            req.body.retentionDays !== undefined && req.body.retentionDays !== null
                ? req.body.retentionDays
                : (process.env.CONSENT_AUDIT_RETENTION_DAYS ?? '365')
        const retentionDays = Number.parseInt(String(retentionRaw), 10)
        if (!Number.isInteger(retentionDays) || retentionDays < 0) {
            return fail(res, 400, 'VALIDATION_ERROR', 'retentionDays must be a non-negative integer')
        }
        const deletedCount = databaseService.purgeOldConsentAuditEvents(retentionDays)
        return ok(res, {
            message: `Consent audit events purged`,
            retentionDays,
            deletedCount
        })
    } catch (error) {
        logger.error('[ERROR] Purge consent audit failed', { error: getErrorObject(error) })
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
