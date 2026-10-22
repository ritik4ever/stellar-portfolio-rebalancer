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

/**
 * Operator-facing delivery state derived from the outcome of a delivery.
 *
 * - `success`: the provider confirmed acceptance.
 * - `delayed`: the provider proved it did not act, but retries are exhausted or
 *   still pending. The work is not blocked; it can be replayed safely.
 * - `blocked`: the outcome is unknown (ambiguous) or the provider rejected
 *   the message permanently. Replaying automatically would risk a duplicate
 *   or just fail again, so an operator must intervene.
 */
export type DeliveryState = "success" | "delayed" | "blocked";

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
 * Map a failure kind to the operator-facing delivery state. Retryable failures
 * are delayed work (safe to replay); ambiguous and permanent failures are blocked
 * (replaying automatically would risk a duplicate or just fail again).
 */
export function deliveryStateForFailureKind(kind: DeliveryFailureKind): DeliveryState {
  return kind === "retryable" ? "delayed" : "blocked";
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
 * 4. Operators can distinguish success, delay, and blocked work from the
 *    `deliveryState` log metadata and the metric outcome label.
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
        deliveryState: "success",
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
        deliveryState: "blocked",
      });
      return;
    }

    // 2. Concurrency control: if a delivery is currently in flight for the same event, deduplicate
    if (inFlightDeliveries.has(deliveryKey)) {
      logOutcome(userId, provider, eventType, "skipped", "Concurrent notification deduplicated: delivery in progress", {
        attempt: 1,
        maxAttempts: policy.maxAttempts,
        deliveryId,
        deliveryState: "delayed",
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
            deliveryState: "success",
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
              deliveryState: "delayed",
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
          const deliveryState = deliveryStateForFailureKind(assessment.kind);
          // Retryable failures that exhausted the retry budget are delayed work:
          // the provider proved it did not act, so a replay is safe. Ambiguous
          // and permanent failures are blocked.
          const metricOutcome: 'success' | 'failure' | 'delayed' =
            deliveryState === "delayed" ? 'delayed' : 'failure';
          const metricReason = ambiguous
            ? 'delivery_unknown'
            : deliveryState === "delayed"
              ? 'retry_exhausted'
              : assessment.reason;
          recordNotificationDeliveryAttempt(provider, 'failure');
          recordNotificationDelivery({
            channel: provider,
            outcome: metricOutcome,
            reason: metricReason,
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
              deliveryState,
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
    } finally {
      if (!finalOutcomeLogged) {
        // Delivery was aborted before a terminal outcome was recorded.
        // Treat it as delayed work so operators know a replay is safe.
        logOutcome(userId, provider, eventType, "failed", "Delivery aborted before completion", {
          attempt: currentAttempt,
          maxAttempts: policy.maxAttempts,
          deliveryId,
          deliveryState: "deliayed",
        });
      }
    }
  };

  if (deliveryKey) {
    const inFlight = runDelivery();
    inFlightDeliveries.set(deliveryKey, inFlight);
    try {
      await inFlight;
    } finally {
      inFlightDeliveries.delete(deliveryKey);
    }
    return;
  }

  await runDelivery();
}

/**
 * Bounded, consistent classification of a delivery error for metric labels.
 * Never includes the raw message (ids, timestamps) to keep label cardinality low.
 */
export function classifyFailureReason(error: unknown): string {
  const code = extractCode(error);
  const message = extractMessage(error);
  const status = extractStatus(error);

  if (status === 401 || status === 403) return "auth";
  if (status === 428) return "rate_limited";
  if (status === 408) return "timeout";
  if (status !== undefined && status >= 500) return "server_error";
  if (status !== undefined && status >= 400) return "client_error";

  if (code === "ETIMEDOUT" || code === "ESCKETTIMEDOUT") return "timeout";
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EPIPE") {
    return "connection_refused";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  if (code === "EAUTH" || code.startsWith("EAUTH")) return "auth";
  if (/timeout|timed out/i.test(message)) return "timeout";
  if (/auth|unauthorized|forbidden/i.test(message)) return "auth";
  if (/rate limit|too many requests/i.test(message)) return "rate_limited";
  if (/recipient|address/i.test(message)) return "invalid_recipient";
  if (/connection refused|connection reset/i.test(message)) {
    return "connection_refused";
  }
  return "unknown";
}

function extractCode(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code.toUpperCase();
  }
  return "";
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error ?? "");
}

function extractStatus(error: unknown): number | undefined {
  if (error && typeof error === "object") {
    const candidate = error as { status?: unknown; statusCode?: unknown };
    for (const value of [candidate.status, candidate.statusCode]) {
      if (typeof value === "number") return value;
    }
  }
  return undefined;
}

function logOutcome(
  userId: string,
  provider: NotificationProviderName,
  eventType: string,
  outcome: string,
  errorMessage: string | undefined,
  metadata: NotificationLogMetadata,
): void {
  try {
    dbLogNotificationOutcome(userId, provider, eventType, outcome, errorMessage, metadata);
  } catch (error) {
    logger.error("Failed to persist notification delivery outcome", {
      provider,
      userId,
      eventType,
      outcome,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
