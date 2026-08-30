import { logger } from "../utils/logger.js";
import {
  dbLogNotificationOutcome,
  type NotificationLogMetadata,
} from "../db/notificationDb.js";
import {
  computeBackoffDelayMs,
  type DeliveryBackoffPolicy,
} from "../config/notificationDeliveryConfig.js";
import {
  recordNotificationDelivery,
  recordNotificationDeliveryAttempt,
} from "../observability/metrics.js";

/**
 * Delivery channels. Email and webhook are wired through deliverWithBackoff today;
 * the rest are declared so their metrics share one label vocabulary as they land.
 */
export type NotificationProviderName =
  | "email"
  | "webhook"
  | "slack"
  | "sms"
  | "telegram";

export const NOTIFICATION_CHANNELS: NotificationProviderName[] = [
  "email",
  "webhook",
  "slack",
  "sms",
  "telegram",
];

export interface DeliveryAttemptContext {
  provider: NotificationProviderName;
  userId: string;
  eventType: string;
  policy: DeliveryBackoffPolicy;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes a provider delivery with configurable exponential backoff and structured logging.
 */
export async function deliverWithBackoff(
  ctx: DeliveryAttemptContext,
  execute: () => Promise<void>,
): Promise<void> {
  const { provider, userId, eventType, policy } = ctx;
  let lastError: unknown
  const startedAt = Date.now()

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      await execute()
      recordNotificationDeliveryAttempt(provider, 'success')
      recordNotificationDelivery({
        channel: provider,
        outcome: 'success',
        eventType,
        durationSeconds: (Date.now() - startedAt) / 1000,
      })
      logOutcome(userId, provider, eventType, "sent", undefined, {
        attempt,
        maxAttempts: policy.maxAttempts,
      })
      return
    } catch (error) {
      lastError = error
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      const retriesRemaining = attempt < policy.maxAttempts

      if (retriesRemaining) {
        recordNotificationDeliveryAttempt(provider, 'retried')
        const retryIndex = attempt - 1
        const backoffDelayMs = computeBackoffDelayMs(policy, retryIndex)
        logOutcome(userId, provider, eventType, "retried", errorMessage, {
          attempt,
          maxAttempts: policy.maxAttempts,
          backoffDelayMs,
          nextAttempt: attempt + 1,
        })
        logger.warn("Notification delivery failed; scheduling backoff retry", {
          provider,
          userId,
          eventType,
          attempt,
          maxAttempts: policy.maxAttempts,
          backoffDelayMs,
          error: errorMessage,
        })
        await sleep(backoffDelayMs)
        continue
      }

      recordNotificationDeliveryAttempt(provider, 'failure')
      recordNotificationDelivery({
        channel: provider,
        outcome: 'failure',
        reason: classifyFailureReason(error),
        eventType,
        durationSeconds: (Date.now() - startedAt) / 1000,
      })
      logOutcome(userId, provider, eventType, "failed", errorMessage, {
        attempt,
        maxAttempts: policy.maxAttempts,
      })
      logger.error("Notification delivery exhausted retries", {
        provider,
        userId,
        eventType,
        attempt,
        maxAttempts: policy.maxAttempts,
        error: errorMessage,
      })
      throw error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "Notification delivery failed"))
}

function logOutcome(
  userId: string,
  provider: NotificationProviderName,
  eventType: string,
  status: "sent" | "failed" | "retried" | "skipped",
  errorMessage: string | undefined,
  metadata: NotificationLogMetadata,
): void {
  dbLogNotificationOutcome(
    userId,
    provider,
    eventType,
    status,
    errorMessage,
    metadata,
  )
}

/**
 * Bucket a delivery error into a small, bounded set of reasons for the metric
 * label. Raw error strings are deliberately not used — they are unbounded and
 * would explode Prometheus label cardinality.
 */
export function classifyFailureReason(error: unknown): string {
  const err = error as { code?: string; status?: number; response?: { status?: number }; message?: string } | undefined
  const status = err?.status ?? err?.response?.status
  const code = typeof err?.code === 'string' ? err.code.toUpperCase() : ''
  const message = (err?.message ?? String(error ?? '')).toLowerCase()

  if (status === 401 || status === 403) return 'auth'
  if (status === 408 || status === 429) return status === 429 ? 'rate_limited' : 'timeout'
  if (typeof status === 'number' && status >= 500) return 'server_error'
  if (typeof status === 'number' && status >= 400) return 'client_error'

  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || message.includes('timeout') || message.includes('timed out')) {
    return 'timeout'
  }
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EPIPE') return 'connection_refused'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || message.includes('getaddrinfo')) return 'dns'
  if (code.startsWith('EAUTH') || message.includes('invalid login') || message.includes('unauthorized')) return 'auth'
  if (message.includes('not configured') || message.includes('missing config')) return 'not_configured'
  if (message.includes('invalid') && message.includes('address')) return 'invalid_recipient'
  if (code) return code.toLowerCase()

  return 'unknown'
}

/**
 * Record a delivery for a channel that does not go through `deliverWithBackoff`
 * (a fire-and-forget send, or a provider with its own retry handling), so every
 * channel reports through the same counters.
 */
export function recordChannelDelivery(input: {
  channel: NotificationProviderName
  success: boolean
  error?: unknown
  eventType?: string
  durationMs?: number
}): void {
  recordNotificationDeliveryAttempt(input.channel, input.success ? 'success' : 'failure')
  recordNotificationDelivery({
    channel: input.channel,
    outcome: input.success ? 'success' : 'failure',
    reason: input.success ? undefined : classifyFailureReason(input.error),
    eventType: input.eventType,
    durationSeconds: typeof input.durationMs === 'number' ? input.durationMs / 1000 : undefined,
  })
}
