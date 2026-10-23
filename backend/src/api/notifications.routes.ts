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
    type DeadLetterItem,
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

// ── Webhook dead-letter queue (admin) ─────────────────────────────────────────
//
// These endpoints are the operator-facing view of the persisted dead-letter
// records written by the webhook delivery path. They must agree with what the
// retry logic actually did:
//   * only definitively failed deliveries are listed (unknown outcomes are never
//     queued, so nothing here is "maybe already delivered"),
//   * `deliveryId` ties an entry back to its `notification_logs` rows,
//   * a successful replay removes the entry, a failed one re-queues it with the
//     incremented attempt count so nothing is silently lost.

function webhookReplayPolicy() {
    const config = getNotificationDeliveryConfig()
    return {
        ...config.webhook,
        maxAttempts: Math.min(config.webhook.maxAttempts, 5),
    }
}

/**
 * Replay one dead-letter entry through the normal delivery pipeline (retry +
 * logging) and keep the queue in sync with the outcome.
 */
async function replayDeadLetterItem(item: DeadLetterItem): Promise<void> {
    const policy = webhookReplayPolicy()

    try {
        await deliverWithBackoff(
            {
                provider: 'webhook',
                userId: item.userId,
                eventType: item.eventType,
                policy,
                deliveryId: item.deliveryId,
            },
            () => postDeadLetterPayload(item, policy.requestTimeoutMs || 5000),
        )
    } catch (error) {
        await webhookDeadLetterQueue.requeue(item)
        throw error
    }
}

function asQueryText(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asQueryNumber(value: unknown): number | undefined {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
}

function asPathParam(value: string | string[]): string {
    return Array.isArray(value) ? value[0] ?? '' : value
}

// List webhook dead-letter items
notificationsRouter.get('/admin/notifications/dead-letter', requireJwtWhenEnabled, requireAdmin, async (req: Request, res: Response) => {
    try {
        const items = await webhookDeadLetterQueue.list()
        const listing = queryDeadLetterItems(items, {
            userId: asQueryText(req.query.userId),
            eventType: asQueryText(req.query.eventType),
            search: asQueryText(req.query.search),
            page: asQueryNumber(req.query.page),
            pageSize: asQueryNumber(req.query.pageSize) ?? asQueryNumber(req.query.limit),
        })

        return ok(res, listing)
    } catch (error) {
        logger.error('Failed to list webhook dead-letter items', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// Replay a webhook dead-letter item
notificationsRouter.post('/admin/notifications/dead-letter/:id/replay', requireJwtWhenEnabled, requireAdmin, async (req: Request, res: Response) => {
    try {
        // Claim the entry first so a concurrent replay cannot deliver it twice.
        const item = await webhookDeadLetterQueue.replay(asPathParam(req.params.id))
        if (!item) {
            return fail(res, 404, 'NOT_FOUND', 'Dead-letter item not found')
        }

        try {
            await replayDeadLetterItem(item)
        } catch (replayError) {
            logger.error('Webhook dead-letter replay failed; item re-queued', {
                error: getErrorObject(replayError),
                itemId: item.id,
                deliveryId: item.deliveryId,
            })
            return fail(res, 502, 'REPLAY_FAILED', 'Replay delivery failed, item re-queued')
        }

        return ok(res, {
            replayed: true,
            id: item.id,
            deliveryId: item.deliveryId,
            attemptsExhausted: item.attemptsExhausted,
        })
    } catch (error) {
        logger.error('Failed to replay webhook dead-letter item', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// Replay several webhook dead-letter items (or every queued item)
notificationsRouter.post('/admin/notifications/dead-letter/batch-replay', requireJwtWhenEnabled, requireAdmin, async (req: Request, res: Response) => {
    try {
        const { ids, replayAll } = (req.body ?? {}) as { ids?: string[]; replayAll?: boolean }

        if (!Array.isArray(ids) && !replayAll) {
            return fail(res, 400, 'VALIDATION_ERROR', 'Either ids array or replayAll flag is required')
        }

        const allItems = await webhookDeadLetterQueue.list()
        const itemsToReplay = replayAll
            ? allItems
            : allItems.filter((item) => ids!.includes(item.id))

        if (itemsToReplay.length === 0) {
            return fail(res, 404, 'NOT_FOUND', 'No matching dead-letter items found')
        }

        const results = {
            total: itemsToReplay.length,
            succeeded: 0,
            failed: 0,
            failedIds: [] as string[],
        }

        for (const item of itemsToReplay) {
            // Claim the entry first so it is delivered at most once, even if two
            // batch replays overlap.
            const claimed = await webhookDeadLetterQueue.replay(item.id)
            if (!claimed) {
                results.failed++
                results.failedIds.push(item.id)
                continue
            }

            try {
                await replayDeadLetterItem(claimed)
                results.succeeded++
            } catch {
                results.failed++
                results.failedIds.push(item.id)
            }
        }

        return ok(res, {
            message: `Batch replay completed: ${results.succeeded} succeeded, ${results.failed} failed`,
            results,
        })
    } catch (error) {
        logger.error('Failed to batch replay webhook dead-letter items', { error: getErrorObject(error) })
        return fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))
    }
})

// Drop a webhook dead-letter item without replaying it
notificationsRouter.delete('/admin/notifications/dead-letter/:id', requireJwtWhenEnabled, requireAdmin, async (req: Request, res: Response) => {
    try {
        const deleted = await webhookDeadLetterQueue.delete(asPathParam(req.params.id))
        if (!deleted) {
            return fail(res, 404, 'NOT_FOUND', 'Dead-letter item not found')
        }

        return ok(res, { deleted: true, id: asPathParam(req.params.id) })
    } catch (error) {
        logger.error('Failed to delete webhook dead-letter item', { error: getErrorObject(error) })
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