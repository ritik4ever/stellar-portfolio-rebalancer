import crypto from 'crypto';
import axios, { AxiosError } from 'axios';
import {
  redactWebhookEndpoint,
  reportWebhookDeliveryAttemptStarted,
  reportWebhookDeliveryOutcome,
  type WebhookDeliveryState,
} from '../services/webhookDeliveryOutcome.js';

interface WebhookPayload {
  event_type: 'DRIFT_EXCEEDED' | 'REBALANCE_COMPLETED' | 'CIRCUIT_BREAKER_TRIGGERED';
  portfolio_id: string;
  timestamp: number;
  drift_details?: any;
  rebalance_summary?: any;
}

export interface WebhookDeliveryResult {
  /** Stable identifier for this delivery attempt (derived from signature + timestamp). */
  deliveryId: string;
  /** Whether the delivery was accepted by the receiver. */
  delivered: boolean;
  /** HTTP status code returned by the receiver, if any. */
  statusCode?: number;
  /** When the receiver asked us to retry, in milliseconds from now. */
  retryAfterMs?: number;
  /** Absolute timestamp (epoch ms) of the next attempt, if a retry is scheduled. */
  nextAttemptAt?: number;
  /** Deterministic deduplication key so retries are idempotent at the receiver. */
  deduplicationKey: string;
  /** Whether this attempt should be retried. */
  retryable: boolean;
  /** Retry decision taken by the delivery layer. */
  outcome: 'delivered' | 'retry' | 'dead-letter';
  /**
   * Operator-facing state for this attempt (SPR-2026-174): `success`,
   * `delayed` (retry scheduled) or `blocked` (dead-letter / permanent failure).
   */
  deliveryState: WebhookDeliveryState;
  /** Bounded, metric-safe reason for the outcome. */
  reason: string;
  /** Sanitized error message if the delivery failed. */
  error?: string;
}

const DEFAULT_RETRY_AFTER_MS = 60_000;
const MAX_RETRY_AFTER_MS = 86_400_000;

const parseRetryAfter = (header: unknown): number | undefined => {
  if (header === undefined || header === null) {
    return undefined;
  }

  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.min(raw * 1000, MAX_RETRY_AFTER_MS));
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return undefined;
    }

    // Retry-After may be delta-seconds.
    if (!isNaN(Number(trimmed))) {
      const seconds = Number(trimmed);
      return Math.max(0, Math.min(seconds * 1000, MAX_RETRY_AFTER_MS));
    }

    // Retry-After may be an HTTP-date.
    const parsedDate = Date.parse(trimmed);
    if (!Number.isNaN(parsedDate)) {
      const delta = parsedDate - Date.now();
      return Math.max(0, Math.min(delta, MAX_RETRY_AFTER_MS));
    }
  }

  return undefined;
};

const isRetryableStatus = (status: number | undefined): boolean => {
  if (status === undefined) {
    // Network / timeout errors are retryable.
    return true;
  }
  return status === 429 || status >= 500;
};

export const fireWebhook = async (
  url: string,
  secret: string,
  payload: WebhookPayload,
): Promise<WebhookDeliveryResult> => {
  const timestamp = Date.now();
  const body = JSON.stringify({ ...payload, timestamp });

  const signature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  // Stable delivery ID and deduplication key derived from the signed body.
  // Retries of the same event reuse the same key so receivers can dedupe.
  const deliveryId = crypto
    .createHash('sha256')
    .update(`${signature}:${timestamp}`)
    .digest('hex');
  const deduplicationKey = deliveryId;

  const baseResult = { deliveryId, deduplicationKey };
  const source = redactWebhookEndpoint(url);
  const startedAt = Date.now();

  // Record the source and identity *before* the request so an attempt that
  // starts but never reports a terminal outcome is visible as an interrupted
  // worker rather than a silent success (SPR-2026-174).
  reportWebhookDeliveryAttemptStarted({
    source,
    eventType: payload.event_type,
    deliveryId,
    attempt: 1,
    maxAttempts: 1,
  });

  try {
    const response = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': signature,
        'X-Delivery-Id': deliveryId,
        'X-Deduplication-Key': deduplicationKey,
      },
      timeout: 5000,
    });

    const assessment = reportWebhookDeliveryOutcome({
      source,
      eventType: payload.event_type,
      deliveryId,
      attempt: 1,
      maxAttempts: 1,
      statusCode: response.status,
      elapsedMs: Date.now() - startedAt,
    });

    return {
      ...baseResult,
      delivered: true,
      statusCode: response.status,
      retryable: false,
      outcome: 'delivered',
      deliveryState: assessment.state,
      reason: assessment.reason,
    };
  } catch (error) {
    const axiosError = error as AxiosError | undefined;
    // Network failures have no response; do not invent a status for them — the
    // fabricated 429 previously made timeouts indistinguishable from a
    // receiver-requested backoff.
    const statusCode = axiosError?.response?.status;
    const retryable = isRetryableStatus(statusCode);
    const errorMessage = axiosError?.message ?? 'Unknown webhook delivery error';

    if (!retryable) {
      const assessment = reportWebhookDeliveryOutcome({
        source,
        eventType: payload.event_type,
        deliveryId,
        attempt: 1,
        maxAttempts: 1,
        statusCode,
        error,
        willRetry: false,
        elapsedMs: Date.now() - startedAt,
      });

      return {
        ...baseResult,
        delivered: false,
        statusCode,
        retryable: false,
        outcome: 'dead-letter',
        deliveryState: assessment.state,
        reason: assessment.reason,
        error: errorMessage,
      };
    }

    // 429 and 5xx responses are retried. Honor Retry-After when present,
    // otherwise fall back to the default backoff delay.
    const retryAfterMs =
      parseRetryAfter(axiosError?.response?.headers?.['retry-after']) ??
      DEFAULT_RETRY_AFTER_MS;
    const nextAttemptAt = Date.now() + retryAfterMs;

    const assessment = reportWebhookDeliveryOutcome({
      source,
      eventType: payload.event_type,
      deliveryId,
      attempt: 1,
      maxAttempts: 1,
      statusCode,
      error,
      retryAfterMs,
      nextAttemptAt,
      willRetry: true,
      elapsedMs: Date.now() - startedAt,
    });

    return {
      ...baseResult,
      delivered: false,
      statusCode,
      retryAfterMs,
      nextAttemptAt,
      retryable: true,
      outcome: 'retry',
      deliveryState: assessment.state,
      reason: assessment.reason,
      error: errorMessage,
    };
  }
};
