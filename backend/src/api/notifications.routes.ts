import { Router, Request, Response } from 'express'
import { notificationService, NotificationService } from '../services/notificationService.js'
import { requireJwtWhenEnabled } from '../middleware/requireJwt.js'
import { requireAdmin } from '../middleware/auth.js'
import { idempotencyMiddleware } from '../middleware/idempotency.js'
import { validateRequest, validateQuery } from '../middleware/validate.js'
import {
    notificationSubscribeSchema,
    notificationQuerySchema,
    notificationPreferencesQuerySchema,
    notificationUnsubscribeQuerySchema,
    notificationUnsubscribeBodySchema,
    notificationThresholdsQuerySchema,
    notificationThresholdsBodySchema,
} from './validation.js'
import { getAuthConfig } from '../services/authService.js'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import { ok, fail } from '../utils/apiResponse.js'
import {
    webhookDeadLetterQueue,
    queryDeadLetterItems,
    postDeadLetterPayload,
} from '../services/webhookDeadLetter.js'
import { deliverWithBackoff } from '../services/notificationDelivery.js'
import { getNotificationDeliveryConfig } from '../config/notificationDeliveryConfig.js'

export const notificationsRouter = Router()

// Subscribe to notifications
notificationsRouter.post('/notifications/subscribe', requireJwtWhenEnabled, idempotencyMiddleware, validateRequest(notificationSubscribeSchema), async (req: Request, res: Response) => {
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
        const { emailEnabled, webhookEnabled, webhookUrl, slackEnabled, slackWebhookUrl, smsEnabled, phoneNumber, events, emailAddress, digestMode } = req.body

        if (emailEnabled && !notificationService.isEmailTransportAvailable()) {
            return fail(res, 503, 'SERVICE_UNAVAILABLE', 'Email notification transport is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS environment variables.')
        }

        notificationService.subscribe({
            userId,
            emailEnabled,
            emailAddress,
            webhookEnabled,
            webhookUrl,
            slackEnabled,
            slackWebhookUrl,
            smsEnabled,
            phoneNumber,
            digestMode,
            events
        })

        logger.info('User subscribed to notifications', { userId, emailEnabled, webhookEnabled })

        return ok(res, { message: 'Notification preferences saved successfully' })
    } catch (error) {
        logger.error('Failed to subscribe to notifications', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

notificationsRouter.post('/notifications/sms/verification', requireJwtWhenEnabled, async (req: Request, res: Response) => {
    try {
        const userId = getAuthConfig().enabled ? req.user!.address : req.body?.userId
        if (!userId || !req.body?.phoneNumber) return fail(res, 400, 'VALIDATION_ERROR', 'userId and phoneNumber are required')
        await notificationService.requestSmsVerification(userId, req.body.phoneNumber)
        return ok(res, { message: 'Verification code sent' })
    } catch (error) {
        return fail(res, 400, 'SMS_VERIFICATION_FAILED', getErrorMessage(error))
    }
})

notificationsRouter.post('/notifications/sms/verification/confirm', requireJwtWhenEnabled, async (req: Request, res: Response) => {
    const userId = getAuthConfig().enabled ? req.user!.address : req.body?.userId
    if (!userId || !req.body?.code) return fail(res, 400, 'VALIDATION_ERROR', 'userId and code are required')
    return notificationService.confirmSmsVerification(userId, req.body.code)
        ? ok(res, { message: 'Phone verified and SMS enabled' })
        : fail(res, 400, 'INVALID_VERIFICATION_CODE', 'Code is invalid or expired')
})

// Get notification preferences
// #1803: strict schema + 400 before any DB/contract work.
notificationsRouter.get(
    '/notifications/preferences',
    requireJwtWhenEnabled,
    validateQuery(notificationPreferencesQuerySchema, 400),
    async (req: Request, res: Response) => {
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

        return ok(res, { preferences })
    } catch (error) {
        logger.error('Failed to get notification preferences', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// Get per-asset price alert thresholds
notificationsRouter.get('/notifications/alerts/thresholds', requireJwtWhenEnabled, validateQuery(notificationThresholdsQuerySchema), async (req: Request, res: Response) => {
    try {
        let userId: string | undefined
        if (getAuthConfig().enabled) {
            userId = req.user!.address
            const queryId = req.query.userId as string | undefined
            if (queryId && queryId !== userId) {
                return fail(res, 403, 'FORBIDDEN', 'Cannot read alert thresholds for another user')
            }
        } else {
            userId = req.query.userId as string | undefined
        }

        if (!userId) {
            return fail(res, 400, 'VALIDATION_ERROR', 'userId query parameter is required')
        }

        const thresholds = notificationService.getPriceAlertThresholds(userId)
        const defaultThreshold = notificationService.getDefaultPriceAlertThreshold(userId)

        return ok(res, { thresholds, defaultThreshold })
    } catch (error) {
        logger.error('Failed to get price alert thresholds', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// Set per-asset price alert thresholds
notificationsRouter.put('/notifications/alerts/thresholds', requireJwtWhenEnabled, validateRequest(notificationThresholdsBodySchema), async (req: Request, res: Response) => {
    try {
        let userId: string | undefined
        if (getAuthConfig().enabled) {
            userId = req.user!.address
            const bodyId = req.body?.userId as string | undefined
            if (bodyId && bodyId !== userId) {
                return fail(res, 403, 'FORBIDDEN', 'Cannot manage alert thresholds for another user')
            }
        } else {
            userId = req.body?.userId
        }

        if (!userId) {
            return fail(res, 400, 'VALIDATION_ERROR', 'userId is required')
        }

        const { thresholds } = req.body as { thresholds: Record<string, number> }
        if (!thresholds || Object.keys(thresholds).length === 0) {
            return fail(res, 400, 'VALIDATION_ERROR', 'At least one threshold must be provided')
        }

        notificationService.setPriceAlertThresholds(userId, thresholds)

        const updated = notificationService.getPriceAlertThresholds(userId)
        const defaultThreshold = notificationService.getDefaultPriceAlertThreshold(userId)

        return ok(res, { thresholds: updated, defaultThreshold })
    } catch (error) {
        logger.error('Failed to set price alert thresholds', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// Remove a per-asset price alert threshold
notificationsRouter.delete('/notifications/alerts/thresholds', requireJwtWhenEnabled, validateQuery(notificationThresholdsQuerySchema), async (req: Request, res: Response) => {
    try {
        let userId: string | undefined
        if (getAuthConfig().enabled) {
            userId = req.user!.address
            const queryId = req.query.userId as string | undefined
            if (queryId && queryId !== userId) {
                return fail(res, 403, 'FORBIDDEN', 'Cannot manage alert thresholds for another user')
            }
        } else {
            userId = req.query.userId as string | undefined
        }

        if (!userId) {
            return fail(res, 400, 'VALIDATION_ERROR', 'userId query parameter is required')
        }

        const asset = req.query.asset as string | undefined
        if (!asset) {
            return fail(res, 400, 'VALIDATION_ERROR', 'asset query parameter is required')
        }

        const removed = notificationService.deletePriceAlertThreshold(userId, asset)
        if (!removed) {
            return fail(res, 404, 'NOT_FOUND', `No threshold override found for asset ${asset}`)
        }

        const thresholds = notificationService.getPriceAlertThresholds(userId)
        const defaultThreshold = notificationService.getDefaultPriceAlertThreshold(userId)

        return ok(res, { thresholds, defaultThreshold })
    } catch (error) {
        logger.error('Failed to delete price alert threshold', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// Unsubscribe from notifications
notificationsRouter.delete('/notifications/unsubscribe', requireJwtWhenEnabled, validateQuery(notificationUnsubscribeQuerySchema, 400), validateRequest(notificationUnsubscribeBodySchema, 400), async (req: Request, res: Response) => {
    try {
        // Issue #178: when auth is enabled, only allow unsubscribing own preferences.
        let userId: string | undefined
        if (getAuthConfig().enabled) {
            userId = req.user!.address
            const queryId = req.query.userId as string | undefined
            if (queryId && queryId !== userId) {
                // 403 FORBIDDEN: { success: false, error: { code: 'FORBIDDEN', message: string } }
                return fail(res, 403, 'FORBIDDEN', 'Cannot unsubscribe notification preferences for another user')
            }
        } else {
            userId = req.query.userId as string | undefined
        }

        if (!userId) {
            // 400 VALIDATION_ERROR: { success: false, error: { code: 'VALIDATION_ERROR', message: string } }
            return fail(res, 400, 'VALIDATION_ERROR', 'userId query parameter is required')
        }

        const unsubscribeReason = typeof req.query.reason === 'string' ? req.query.reason.trim() : undefined

        notificationService.unsubscribe(userId)

        logger.info('User unsubscribed from notifications', { userId, reason: unsubscribeReason || undefined })

        // 200 OK: { success: true, data: { message: string } }
        return ok(res, { message: 'Successfully unsubscribed from all notifications' })
    } catch (error) {
        logger.error('Failed to unsubscribe from notifications', { error: getErrorObject(error) })
        // 500 INTERNAL_ERROR: { success: false, error: { code: 'INTERNAL_ERROR', message: string } }
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

        const limit = Math.min(Number(req.query.limit) || 50, 200)
        const logs = notificationService.getDeliveryLogs(userId, limit)

        return ok(res, { logs })
    } catch (error) {
        logger.error('Failed to get notification logs', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// Get notification delivery status
notificationsRouter.get('/notifications/status', requireJwtWhenEnabled, validateQuery(notificationQuerySchema), async (req: Request, res: Response) => {
    try {
        let userId: string | undefined
        if (getAuthConfig().enabled) {
            userId = req.user!.address
            const queryId = req.query.userId as string | undefined
            if (queryId && queryId !== userId) {
                return fail(res, 403, 'FORBIDDEN', 'Cannot read notification status for another user')
            }
        } else {
            userId = req.query.userId as string | undefined
        }

        if (!userId) {
            return fail(res, 400, 'VALIDATION_ERROR', 'userId query parameter is required')
        }

        const status = notificationService.getDeliveryStatus(userId)

        return ok(res, { status })
    } catch (error) {
        logger.error('Failed to get notification delivery status', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// Test notification delivery
notificationsRouter.post('/notifications/test', requireJwtWhenEnabled, async (req: Request, res: Response) => {
    try {
        const userId = getAuthConfig().enabled ? req.user!.address : req.body?.userId
        if (!userId) {
            return fail(res, 400, 'VALIDATION_ERROR', 'userId is required')
        }

        const result = await notificationService.sendTestNotification(userId)

        return ok(res, result)
    } catch (error) {
        logger.error('Failed to send test notification', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// Get webhook dead letter queue items
notificationsRouter.get('/notifications/webhooks/dead-letter', requireJwtWhenEnabled, requireAdmin, async (req: Request, res: Response) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 50, 200)
        const items = queryDeadLetterItems(limit)
        return ok(res, { items, total: webhookDeadLetterQueue.size })
    } catch (error) {
        logger.error('Failed to read webhook dead letter queue', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// Replay a webhook dead letter item
notificationsRouter.post('/notifications/webhooks/dead-letter/:id/replay', requireJwtWhenEnabled, requireAdmin, async (req: Request, res: Response) => {
    try {
        const id = req.params.id
        const item = webhookDeadLetterQueue.get(id)
        if (!item) {
            return fail(res, 404, 'NOT_FOUND', 'Dead letter item not found')
        }

        const config = getNotificationDeliveryConfig()
        const result = await deliverBackoff(item.url, item.payload, config)

        if (result.success) {
            webhookDeadLetterQueue.remove(id)
            return ok(res, { replayed: true, attempts: result.attempts })
        }

        return fail(res, 502, 'DELIVERY_FAILED', 'Replay delivery failed')
    } catch (error) {
        logger.error('Failed to replay webhook dead letter item', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// Purge the webhook dead letter queue
notificationsRouter.delete('/notifications/webhooks/dead-letter', requireJwtWhenEnabled, requireAdmin, async (req: Request, res: Response) => {
    try {
        const count = webhookDeadLetterQueue.size
        webhookDeadLetterQueue.clear()
        return ok(res, { purged: count })
    } catch (error) {
        logger.error('Failed to purge webhook dead letter queue', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})
