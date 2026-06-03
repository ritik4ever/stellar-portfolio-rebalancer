import { logger } from "../utils/logger.js";
import {
  dbLogNotificationOutcome,
  type NotificationLogMetadata,
} from "../db/notificationDb.js";
import {
  computeBackoffDelayMs,
  type DeliveryBackoffPolicy,
} from "../config/notificationDeliveryConfig.js";

export type NotificationProviderName = "email" | "webhook";

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

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      await execute()
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
