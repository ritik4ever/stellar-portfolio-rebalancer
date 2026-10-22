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
  deliveryId?: string;
  signal?: AbortSignal;
}

// In-flight deliveries map to prevent duplicate executions during concurrent work
const inFlightDeliveries = new Map<string, Promise<void>>();
// Cache recently completed deliveries to prevent duplicate notifications
const completedDeliveries = new Map<string, { status: 'sent' | 'failed' | 'uncertain'; timestamp: number }>();

/** Reset delivery tracking maps (used for test isolation) */
export function _resetDeliveriesForTest(): void {
  inFlightDeliveries.clear();
  completedDeliveries.clear();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(signal.reason ?? new Error('Notification delivery aborted'));
    }
    const timer = setTimeout(() => {
      resolve();
    }, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('Notification delivery aborted'));
      },
      { once: true },
    );
  });
}

/**
 * How a failed delivery attempt relates to the provider's side effect.
 *
 * - `retryable`: the provider proved it did not act on the message (no
 *   connection, explicit 4xx/5xx rejection, ...), so a retry cannot duplicate
 *   anything.
 * - `ambiguous`: the request reached the provider but the confirmation never
 *   arrived (for example an SMTP timeout after the message body was accepted).
 *   The provider may already have delivered, so retrying risks a duplicate.
 * - `permanent`: the provider refused the message; retrying cannot help.
 */
export type DeliveryFailureKind = "retryable" | "ambiguous" | "permanent";

export interface DeliveryFailureAssessment {
  kind: DeliveryFailureKind;
  /** Bounded reason, safe to use as a metric label. */
  reason: string;
  /** Stable key identifying the logical notification across attempts. */
  idempotencyKey?: string;
  /** True when the provider may already have performed the side effect. */
  mayHaveDelivered: boolean;
}

export interface NotificationDeliveryErrorOptions {
  kind: DeliveryFailureKind;
  reason: string;
  idempotencyKey?: string;
  cause?: unknown;
}

/**
 * Error thrown by a provider that knows more about a failure than the generic
 * network error can express — most importantly, whether the message may
 * already have been accepted by the provider.
 */
export class NotificationDeliveryError extends Error {
  readonly kind: DeliveryFailureKind;
  readonly reason: string;
  readonly idempotencyKey?: string;

  constructor(message: string, options: NotificationDeliveryErrorOptions) {
    super(message);
    this.name = "NotificationDeliveryError";
    this.kind = options.kind;
    this.reason = options.reason;
    this.idempotencyKey = options.idempotencyKey;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * Classify any delivery error for retry purposes. Providers that can tell an
 * ambiguous outcome apart from a definite failure throw a
 * `NotificationDeliveryError`; everything else keeps the previous behaviour of
 * being retried within the configured bound.
 */
export function assessDeliveryFailure(error: unknown): DeliveryFailureAssessment {
  if (error instanceof NotificationDeliveryError) {
    return {
      kind: error.kind,
      reason: error.reason,
      idempotencyKey: error.idempotencyKey,
      mayHaveDelivered: error.kind === "ambiguous",
    };
  }

  return {
    kind: "retryable",
    reason: classifyFailureReason(error),
    mayHaveDelivered: false,
  };
}

/**
 * Executes a provider delivery with configurable exponential backoff, concurrency
 * deduplication, and structured logging.
 *
 * Guarantees:
 * 1. Exactly one user-visible notification during concurrent and repeated work.
 * 2. Traceable delivery attempts in notification_logs.
 * 3. State consistency: persisted records agree with externally visible results
 *    even when delivery is interrupted or fails.
 */
export async function deliverWithBackoff(
  ctx: DeliveryAttemptContext,
  execute: () => Promise<void>,
): Promise<void> {
  const { provider, userId, eventType, policy, deliveryId, signal } = ctx;

  const deliveryKey = deliveryId
    ? `${provider}:${userId}:${eventType}:${deliveryId}`
    : undefined;

  // 1. Check if an identical notification was already sent successfully
  if (deliveryKey) {
    const prior = completedDeliveries.get(deliveryKey);
    if (prior && prior.status === 'sent') {
      logOutcome(userId, provider, eventType, "skipped", "Duplicate notification: already sent for this event", {
        attempt: 1,
        maxAttempts: policy.maxAttempts,
        deliveryId,
      });
      return;
    }

    // A previous attempt with an unknown outcome must not be repeated
    // automatically: the provider may already have delivered the message.
    if (prior && prior.status === 'uncertain') {
      logOutcome(userId, provider, eventType, "skipped", "Delivery outcome unknown for this event; not resending automatically", {
        attempt: 1,
        maxAttempts: policy.maxAttempts,
        deliveryId,
        retryable: false,
        stoppedEarly: true,
      });
      return;
    }

    // 2. Concurrency control: if a delivery is currently in flight for the same event, deduplicate
    if (inFlightDeliveries.has(deliveryKey)) {
      logOutcome(userId, provider, eventType, "skipped", "Concurrent notification deduplicated: delivery in progress", {
        attempt: 1,
        maxAttempts: policy.maxAttempts,
        deliveryId,
      });
      // Await existing delivery so caller finishes when message is actually delivered
      await inFlightDeliveries.get(deliveryKey);
      return;
    }
  }

  const runDelivery = async (): Promise<void> => {
    let lastError: unknown;
    let finalOutcomeLogged = false;
    let currentAttempt = 1;
    const startedAt = Date.now();

    try {
      for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
        currentAttempt = attempt;

        if (signal?.aborted) {
          throw signal.reason ?? new Error('Notification delivery aborted');
        }

        try {
          await execute();
          finalOutcomeLogged = true;
          recordNotificationDeliveryAttempt(provider, 'success');
          recordNotificationDelivery({
            channel: provider,
            outcome: 'success',
            eventType,
            durationSeconds: (Date.now() - startedAt) / 1000,
          });
          logOutcome(userId, provider, eventType, "sent", undefined, {
            attempt,
            maxAttempts: policy.maxAttempts,
            deliveryId,
          });
          if (deliveryKey) {
            completedDeliveries.set(deliveryKey, { status: 'sent', timestamp: Date.now() });
          }
          return;
        } catch (error) {
          lastError = error;
          const assessment = assessDeliveryFailure(error);
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          // Only failures that prove the provider did not act are retried;
          // ambiguous or permanent failures stop immediately.
          const retriesRemaining =
            attempt < policy.maxAttempts &&
            !signal?.aborted &&
            assessment.kind === "retryable";
          const stoppedEarly =
            attempt < policy.maxAttempts && assessment.kind !== "retryable";

          if (retriesRemaining) {
            recordNotificationDeliveryAttempt(provider, 'retried');
            const retryIndex = attempt - 1;
            const backoffDelayMs = computeBackoffDelayMs(policy, retryIndex);
            logOutcome(userId, provider, eventType, "retried", errorMessage, {
              attempt,
              maxAttempts: policy.maxAttempts,
              backoffDelayMs,
              nextAttempt: attempt + 1,
              deliveryId,
              failureKind: assessment.kind,
              idempotencyKey: assessment.idempotencyKey,
            });
            logger.warn("Notification delivery failed; scheduling backoff retry", {
              provider,
              userId,
              eventType,
              attempt,
              maxAttempts: policy.maxAttempts,
              backoffDelayMs,
              deliveryId,
              idempotencyKey: assessment.idempotencyKey,
              error: errorMessage,
            });
            await sleep(backoffDelayMs, signal);
            continue;
          }

          finalOutcomeLogged = true;
          const ambiguous = assessment.kind === "ambiguous";
          recordNotificationDeliveryAttempt(provider, 'failure');
          recordNotificationDelivery({
            channel: provider,
            outcome: 'failure',
            reason: ambiguous ? 'delivery_unknown' : assessment.reason,
            eventType,
            durationSeconds: (Date.now() - startedAt) / 1000,
          });
          logOutcome(
            userId,
            provider,
            eventType,
            ambiguous ? "uncertain" : "failed",
            errorMessage,
            {
              attempt,
              maxAttempts: policy.maxAttempts,
              deliveryId,
              failureKind: assessment.kind,
              retryable: false,
              stoppedEarly,
              idempotencyKey: assessment.idempotencyKey,
            },
          );
          if (deliveryKey) {
            completedDeliveries.set(deliveryKey, {
              status: ambiguous ? 'uncertain' : 'failed',
              timestamp: Date.now(),
            });
          }
          if (ambiguous) {
            // The provider may already have delivered. Retrying would risk a
            // duplicate side effect, so this is an explicit stop instead.
            logger.error(
              "Notification delivery outcome unknown; retry stopped to avoid duplicate side effects",
              {
                provider,
                userId,
                eventType,
                attempt,
                maxAttempts: policy.maxAttempts,
                deliveryId,
                stoppedEarly,
                idempotencyKey: assessment.idempotencyKey,
                error: errorMessage,
              },
            );
          } else if (assessment.kind === "permanent") {
            logger.error("Notification delivery failed permanently; retry stopped", {
              provider,
              userId,
              eventType,
              attempt,
              maxAttempts: policy.maxAttempts,
              deliveryId,
              stoppedEarly,
              idempotencyKey: assessment.idempotencyKey,
              error: errorMessage,
            });
          } else {
            logger.error("Notification delivery exhausted retries", {
              provider,
              userId,
              eventType,
              attempt,
              maxAttempts: policy.maxAttempts,
              deliveryId,
              idempotencyKey: assessment.idempotencyKey,
              error: errorMessage,
            });
          }
          throw error;
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new Error(String(lastError ?? "Notification delivery failed"));
    } catch (unhandledError) {
      // Interrupted work handling: if delivery failed or was cancelled before logging a final status
      // (e.g. abort signal during backoff, process interruption, unexpected throw), ensure the database
      // reflects 'failed' so persisted record agrees with external failure outcome.
      if (!finalOutcomeLogged) {
        finalOutcomeLogged = true;
        const msg = unhandledError instanceof Error ? unhandledError.message : String(unhandledError);
        recordNotificationDeliveryAttempt(provider, 'failure');
        recordNotificationDelivery({
          channel: provider,
          outcome: 'failure',
          reason: classifyFailureReason(unhandledError),
          eventType,
          durationSeconds: (Date.now() - startedAt) / 1000,
        });
        logOutcome(userId, provider, eventType, "failed", `Interrupted: ${msg}`, {
          attempt: currentAttempt,
          maxAttempts: policy.maxAttempts,
          deliveryId,
        });
        if (deliveryKey) {
          completedDeliveries.set(deliveryKey, { status: 'failed', timestamp: Date.now() });
        }
      }
      throw unhandledError;
    } finally {
      if (deliveryKey) {
        inFlightDeliveries.delete(deliveryKey);
      }
    }
  };

  const deliveryPromise = runDelivery();
  if (deliveryKey) {
    inFlightDeliveries.set(deliveryKey, deliveryPromise);
  }

  return deliveryPromise;
}

function logOutcome(
  userId: string,
  provider: NotificationProviderName,
  eventType: string,
  status: "sent" | "failed" | "retried" | "skipped" | "uncertain",
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
  );
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
