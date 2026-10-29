import { createHash } from 'node:crypto'
import {
    NotificationDeliveryError,
} from './notificationDelivery.js'

/**
 * Webhook delivery safety helpers (SPR-2026-173).
 *
 * Two problems make webhook retries unsafe to reason about without extra data:
 *
 * 1. A retried POST is indistinguishable from a first attempt on the receiving
 *    side, so an endpoint that already processed the first request will process
 *    the retry again. Every outbound webhook therefore carries a deterministic
 *    `X-Webhook-Delivery-Id` header that is reused for every retry (and for a
 *    dead-letter replay) of the same notification.
 * 2. When the request was dispatched but no response arrived (timeout, socket
 *    reset), the endpoint may already have processed it. Those outcomes are
 *    "ambiguous": they must not be queued for an automatic replay, because a
 *    replay could duplicate the side effect.
 */

export interface WebhookDeliveryIdentity {
    userId: string
    eventType: string
    timestamp: string
    title?: string
}

/**
 * Derive a stable idempotency id for one logical webhook notification.
 *
 * Callers that already own a `deliveryId` for the event keep using it; this is
 * the fallback so that even untracked events get one stable id across retries.
 */
export function deriveWebhookDeliveryId(identity: WebhookDeliveryIdentity): string {
    const seed = [
        identity.userId,
        identity.eventType,
        identity.timestamp,
        identity.title ?? '',
    ].join('|')

    return `whk_${createHash('sha256').update(seed).digest('hex').slice(0, 32)}`
}

/**
 * Socket/timeout failures that can happen *after* the request was written to
 * the endpoint. The receiver may have processed the payload, so a replay could
 * duplicate it.
 */
const AMBIGUOUS_ERROR_CODES = new Set([
    'ETIMEDOUT',
    'ECONNRESET',
    'EPIPE',
    'ECONNABORTED',
    'UND_ERR_SOCKET',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'UND_ERR_CLOSED',
])

/**
 * True when a webhook failure leaves the delivery outcome unknown.
 *
 * An `AbortError` comes from the provider's own request timeout: the request
 * had already been dispatched when the timer fired, so the endpoint may have
 * received it. Connection refused / DNS failures are *not* ambiguous — those
 * prove the request never reached the endpoint and stay replayable.
 */
export function isAmbiguousWebhookFailure(error: unknown): boolean {
    let current: unknown = error

    for (let depth = 0; depth < 4 && current; depth++) {
        if (current instanceof NotificationDeliveryError) {
            return current.kind === 'ambiguous'
        }

        if (typeof current !== 'object') return false

        const candidate = current as { name?: unknown; code?: unknown; cause?: unknown }

        if (candidate.name === 'AbortError' || candidate.name === 'TimeoutError') {
            return true
        }

        if (typeof candidate.code === 'string' && AMBIGUOUS_ERROR_CODES.has(candidate.code)) {
            return true
        }

        current = candidate.cause
    }

    return false
}

/**
 * Convert a webhook transport failure into a classified delivery error.
 *
 * Unknown outcomes become `NotificationDeliveryError(kind: "ambiguous")`, which
 * `deliverWithBackoff` treats as terminal: the attempt is logged as `uncertain`
 * and never retried. Definitive failures are returned unchanged so the normal
 * backoff/retry policy still applies.
 */
export function toWebhookDeliveryError(error: unknown, deliveryId: string): unknown {
    if (error instanceof NotificationDeliveryError) {
        return error
    }

    if (!isAmbiguousWebhookFailure(error)) {
        return error
    }

    const detail = error instanceof Error ? error.message : String(error)

    return new NotificationDeliveryError(
        `Webhook delivery outcome unknown for delivery ${deliveryId}: the endpoint may have processed the request before the connection failed (${detail}). Retry stopped to avoid a duplicate delivery.`,
        {
            kind: 'ambiguous',
            reason: 'delivery_unknown',
            idempotencyKey: deliveryId,
            cause: error,
        },
    )
}
