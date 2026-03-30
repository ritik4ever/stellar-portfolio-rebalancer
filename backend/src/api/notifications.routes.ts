import { Router, Request, Response } from 'express'
import { notificationService } from '../services/notificationService.js'
import { requireJwtWhenEnabled } from '../middleware/requireJwt.js'
import { writeRateLimiter, protectedWriteLimiter } from '../middleware/rateLimit.js'
import { idempotencyMiddleware } from '../middleware/idempotency.js'
import { validateRequest, validateQuery } from '../middleware/validate.js'
import { notificationSubscribeSchema, notificationQuerySchema } from './validation.js'
import { getAuthConfig } from '../services/authService.js'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import { ok, fail } from '../utils/apiResponse.js'

export const notificationsRouter = Router()

// Subscribe to notifications
notificationsRouter.post('/notifications/subscribe', requireJwtWhenEnabled, ...protectedWriteLimiter, idempotencyMiddleware, validateRequest(notificationSubscribeSchema), async (req: Request, res: Response) => {
    try {
        // Issue #178: when auth is enabled, derive userId from the token only.
        // Reject requests that try to subscribe on behalf of a different address.
        let userId: string | undefined
        if (getAuthConfig().enabled) {
            userId = req.user!.address
            const bodyId = req.body?.userId as string | undefined
            if (bodyId && bodyId !== userId) {
                return fail(res, 403, 'FORBIDDEN', 'Cannot manage notification preferences for another user')
            }
        } else {
            userId = req.body?.userId
        }

        // Validation
        if (!userId) {
            return fail(res, 400, 'VALIDATION_ERROR', 'userId is required')
        }
        const { emailEnabled, webhookEnabled, webhookUrl, events, emailAddress } = req.body

        notificationService.subscribe({
            userId,
            emailEnabled,
            emailAddress,
            webhookEnabled,
            webhookUrl,
            events
        })

        logger.info('User subscribed to notifications', { userId, emailEnabled, webhookEnabled })

        return ok(res, { message: 'Notification preferences saved successfully' })
    } catch (error) {
        logger.error('Failed to subscribe to notifications', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// Get notification preferences
notificationsRouter.get('/notifications/preferences', requireJwtWhenEnabled, validateQuery(notificationQuerySchema), async (req: Request, res: Response) => {
    try {
        // Issue #178: when auth is enabled, only allow reading own preferences.
        let userId: string | undefined
        if (getAuthConfig().enabled) {
            userId = req.user!.address
            const queryId = req.query.userId as string | undefined
            if (queryId && queryId !== userId) {
                return fail(res, 403, 'FORBIDDEN', 'Cannot read notification preferences for another user')
            }
        } else {
            userId = req.query.userId as string | undefined
        }

        if (!userId) {
            return fail(res, 400, 'VALIDATION_ERROR', 'userId query parameter is required')
        }

        const preferences = notificationService.getPreferences(userId)

        if (!preferences) {
            return ok(res, { preferences: null, message: 'No preferences found for this user' })
        }

        return ok(res, { preferences })
    } catch (error) {
        logger.error('Failed to get notification preferences', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// Unsubscribe from notifications
notificationsRouter.delete('/notifications/unsubscribe', requireJwtWhenEnabled, writeRateLimiter, validateQuery(notificationQuerySchema), async (req: Request, res: Response) => {
    try {
        // Issue #178: when auth is enabled, only allow unsubscribing own preferences.
        let userId: string | undefined
        if (getAuthConfig().enabled) {
            userId = req.user!.address
            const queryId = req.query.userId as string | undefined
            if (queryId && queryId !== userId) {
                return fail(res, 403, 'FORBIDDEN', 'Cannot unsubscribe notification preferences for another user')
            }
        } else {
            userId = req.query.userId as string | undefined
        }

        if (!userId) {
            return fail(res, 400, 'VALIDATION_ERROR', 'userId query parameter is required')
        }

        notificationService.unsubscribe(userId)

        logger.info('User unsubscribed from notifications', { userId })

        return ok(res, { message: 'Successfully unsubscribed from all notifications' })
    } catch (error) {
        logger.error('Failed to unsubscribe from notifications', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// Get notification delivery logs
notificationsRouter.get('/notifications/logs', requireJwtWhenEnabled, validateQuery(notificationQuerySchema), async (req: Request, res: Response) => {
    try {
        let userId: string | undefined
        
        if (getAuthConfig().enabled) {
            userId = req.user!.address
            const queryId = req.query.userId as string | undefined
            if (queryId && queryId !== userId) {
                return fail(res, 403, 'FORBIDDEN', 'Cannot read notification logs for another user')
            }
        } else {
            userId = req.query.userId as string | undefined
        }

        if (!userId) {
            return fail(res, 400, 'VALIDATION_ERROR', 'userId query parameter is required')
        }

        const logs = notificationService.getLogs(userId)

        return ok(res, { logs })
    } catch (error) {
        logger.error('Failed to get notification logs', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})
