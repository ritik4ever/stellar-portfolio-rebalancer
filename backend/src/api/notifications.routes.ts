import { Router, Request, Response } from 'express'
import { notificationService, NotificationService } from '../services/notificationService.js'
import { requireJwtWhenEnabled } from '../middleware/requireJwt.js'
import { requireAdmin } from '../middleware/auth.js'
import { idempotencyMiddleware } from '../middleware/idempotency.js'
import { validateRequest, validateQuery } from '../middleware/validate.js'
import { notificationSubscribeSchema, notificationQuerySchema } from './validation.js'
import { getAuthConfig } from '../services/authService.js'
import { logger } from '../utils/logger.js'
import { getErrorObject, getErrorMessage } from '../utils/helpers.js'
import { ok, fail } from '../utils/apiResponse.js'
import { webhookDeadLetterQueue } from '../services/webhookDeadLetter.js'
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
        const { emailEnabled, webhookEnabled, webhookUrl, events, emailAddress, digestMode } = req.body

        if (emailEnabled && !notificationService.isEmailTransportAvailable()) {
            return fail(res, 503, 'SERVICE_UNAVAILABLE', 'Email notification transport is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS environment variables.')
        }

        notificationService.subscribe({
            userId,
            emailEnabled,
            emailAddress,
            webhookEnabled,
            webhookUrl,
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

        return ok(res, { preferences })
    } catch (error) {
        logger.error('Failed to get notification preferences', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// Unsubscribe from notifications
notificationsRouter.delete('/notifications/unsubscribe', requireJwtWhenEnabled, validateQuery(notificationQuerySchema), async (req: Request, res: Response) => {
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

        const unsubscribeReason = typeof req.query.reason === 'string' ? req.query.reason.trim() : undefined

        notificationService.unsubscribe(userId)

        logger.info('User unsubscribed from notifications', { userId, reason: unsubscribeReason || undefined })

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

// Unsubscribe via email link (token-based, no JWT required)
notificationsRouter.get('/notifications/unsubscribe', async (req: Request, res: Response) => {
    try {
        const userId = req.query.userId as string | undefined
        const token = req.query.token as string | undefined

        if (!userId || !token) {
            return fail(res, 400, 'VALIDATION_ERROR', 'userId and token query parameters are required')
        }

        if (!NotificationService.verifyUnsubscribeToken(userId, token)) {
            return fail(res, 401, 'UNAUTHORIZED', 'Invalid or expired unsubscribe link')
        }

        notificationService.unsubscribe(userId)

        logger.info('User unsubscribed via email link', { userId })

        return ok(res, { message: 'Successfully unsubscribed from all notifications' })
    } catch (error) {
        logger.error('Failed to unsubscribe via email link', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// Verify inbound webhook callback signature
notificationsRouter.post('/notifications/webhook/callback', async (req: Request, res: Response) => {
    try {
        const signatureHeader = req.headers['x-signature-256'] as string | undefined
        const body = JSON.stringify(req.body)
        const secret = process.env.WEBHOOK_SIGNING_SECRET

        if (!secret) {
            logger.warn('Webhook callback received but no WEBHOOK_SIGNING_SECRET configured')
            return fail(res, 503, 'SERVICE_UNAVAILABLE', 'Webhook verification not configured')
        }

        const valid = NotificationService.verifyCallbackSignature(body, signatureHeader, secret)

        if (!valid) {
            logger.warn('Webhook callback rejected: invalid signature', {
                ip: req.ip,
                signature: signatureHeader ? `${signatureHeader.slice(0, 20)}...` : undefined,
            })
            return fail(res, 401, 'UNAUTHORIZED', 'Invalid webhook signature')
        }

        logger.info('Webhook callback verified successfully')
        return ok(res, { status: 'verified' })
    } catch (error) {
        logger.error('Webhook callback verification error', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

notificationsRouter.get('/admin/notifications/dead-letter', requireAdmin, async (req: Request, res: Response) => {
    try {
        const items = await webhookDeadLetterQueue.list()
        return ok(res, { items, count: items.length })
    } catch (error) {
        logger.error('Failed to list dead-letter items', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

notificationsRouter.post('/admin/notifications/dead-letter/:id/replay', requireAdmin, async (req: Request, res: Response) => {
    try {
        const itemId = req.params.id
        const item = await webhookDeadLetterQueue.replay(itemId)
        if (!item) {
            return fail(res, 404, 'NOT_FOUND', 'Dead-letter item not found')
        }

        const deliveryConfig = getNotificationDeliveryConfig()
        const policy = {
            ...deliveryConfig.webhook,
            maxAttempts: Math.min(deliveryConfig.webhook.maxAttempts, 5),
        }

        try {
            await deliverWithBackoff(
                {
                    provider: 'webhook',
                    userId: item.userId,
                    eventType: item.eventType,
                    policy,
                },
                async () => {
                    const controller = new AbortController()
                    const timeout = policy.requestTimeoutMs || 5000
                    const timeoutId = setTimeout(() => controller.abort(), timeout)
                    try {
                        const response = await fetch(item.webhookUrl, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-Webhook-Event': item.eventType,
                            },
                            body: JSON.stringify(item.payload),
                            signal: controller.signal,
                        })
                        if (!response.ok) {
                            throw new Error(`Webhook responded with status ${response.status}`)
                        }
                    } finally {
                        clearTimeout(timeoutId)
                    }
                },
            )
            return ok(res, { message: 'Dead-letter item replayed successfully' })
        } catch (replayError) {
            await webhookDeadLetterQueue.push(item)
            return fail(res, 502, 'REPLAY_FAILED', 'Replay delivery failed, item re-queued')
        }
    } catch (error) {
        logger.error('Failed to replay dead-letter item', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

notificationsRouter.delete('/admin/notifications/dead-letter/:id', requireAdmin, async (req: Request, res: Response) => {
    try {
        const itemId = req.params.id
        const deleted = await webhookDeadLetterQueue.delete(itemId)
        if (!deleted) {
            return fail(res, 404, 'NOT_FOUND', 'Dead-letter item not found')
        }
        return ok(res, { message: 'Dead-letter item deleted' })
    } catch (error) {
        logger.error('Failed to delete dead-letter item', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})
