/**
 * Actionable webhook delivery outcomes (SPR-2026-174).
 *
 * The delivery layer already knows *whether* a webhook attempt failed, but an
 * operator triaging a provider incident needs to tell three states apart:
 *
 * - `success`: the receiver acknowledged the delivery (2xx).
 * - `delayed`: the attempt failed in a way that proves the receiver did not
 *   accept the payload, and a retry is still scheduled. Nothing is lost yet.
 * - `blocked`: the attempt can no longer make progress on its own — the retry
 *   budget is exhausted, the receiver rejected the payload permanently, or the
 *   destination is misconfigured. A human (or the dead-letter replay flow) has
 *   to act.
 *
 * Every observation is recorded with the *source* (redacted endpoint), the
 * delivery identity, the attempt counters, the HTTP status and the next attempt
 * time. Ids alone are useless after a worker restart, so the attempt-start
 * record is written *before* the request and the terminal record only after the
 * outcome is known. A start record without a matching terminal record is the
 * signature of an interrupted worker.
 *
 * Nothing in this module may expose credentials: webhook URLs routinely carry
 * capability tokens in the path or query string, and signing secrets are
 * derived from the payload. Endpoints are redacted to origin + a stable short
 * digest of the path so two attempts can still be correlated.
 */
import { createHash } from 'node:crypto'

import { logger } from '../utils/logger.js'
import { recordWebhookDeliveryOutcome as recordWebhookOutcomeMetric } from '../observability/metrics.js'
import { classifyFailureReason } from './notificationDelivery.js'

/** Operator-facing state of one webhook delivery attempt. */
export type WebhookDeliveryState = 'success' | 'delayed' | 'blocked'

export interface WebhookDeliveryContext {
  /** Redacted destination, safe to log. Build it with `redactWebhookEndpoint`. */
  source: string
  eventType: string
  deliveryId?: string
  userId?: string
  /** 1-based attempt number. */
  attempt: number
  maxAttempts: number
  statusCode?: number
  /** Retry delay requested by the receiver (`Retry-After`), in milliseconds. */
  retryAfterMs?: number
  /** Absolute epoch-ms timestamp of the scheduled next attempt. */
  nextAttemptAt?: number
  elapsedMs?: number
  error?: unknown
  /**
   * Whether a retry is scheduled. Defaults to `attempt < maxAttempts`; set it
   * explicitly when the retry is owned by the caller instead of the policy.
   */
  willRetry?: boolean
}

export interface WebhookDeliveryAssessment {
  state: WebhookDeliveryState
  /** Bounded, metric-safe reason code (never a raw provider message). */
  reason: string
  retryable: boolean
  /** True when the receiver may already have processed the payload. */
  mayHaveDelivered: boolean
  /** Sanitised diagnostic detail; empty for successful deliveries. */
  detail?: string
}

export interface WebhookDeliveryAssessmentInput {
  statusCode?: number
  error?: unknown
  /**
   * Whether a further attempt is still scheduled. A retryable failure with no
   * retry left is blocked work, not delayed work.
   */
  willRetry: boolean
}

const MAX_DETAIL_LENGTH = 200

/**
 * Redact a webhook endpoint for logging.
 *
 * The scheme, host and port stay visible (they tell operators which provider is
 * failing); the path, query and fragment are replaced by a stable short digest
 * so repeated attempts against the same destination still correlate without
 * leaking the capability token that usually lives in the path.
 */
export function redactWebhookEndpoint(endpoint: string | undefined): string {
  if (!endpoint || typeof endpoint !== 'string') return '[unknown-endpoint]'
  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    return '[invalid-endpoint]'
  }

  const digest = createHash('sha256')
    .update(`${parsed.pathname}${parsed.search}`)
    .digest('hex')
    .slice(0, 8)

  return `${parsed.protocol}//${parsed.host}/[redacted:${digest}]`
}

/**
 * Remove secret-bearing fragments from a diagnostic detail before it is
 * logged. Webhook failures often echo the request URL (which can contain a
 * token) or a provider response that quotes an auth header.
 */
export function sanitizeWebhookDetail(detail: string | undefined): string {
  if (!detail) return ''

  const sanitized = detail
    .replace(/https?:\/\/[^\s"'<>]+/gi, (match) => redactWebhookEndpoint(match))
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\bBasic\s+[A-Za-z0-9+/]+=*/gi, 'Basic [redacted]')
    .replace(/((?:secret|token|signature|key|password|auth)=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[redacted]')

  return sanitized.length > MAX_DETAIL_LENGTH
    ? `${sanitized.slice(0, MAX_DETAIL_LENGTH)}…`
    : sanitized
}

/** HTTP status of an error object, when the client attached one. */
function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const candidate = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } }
  for (const value of [candidate.status, candidate.statusCode, candidate.response?.status]) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

/**
 * The provider aborts through an AbortController when our own request timeout
 * elapses; fetch reports that as an `AbortError` whose message does not always
 * mention "timeout", so classify it explicitly instead of as `unknown`.
 */
function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: unknown }).name
  const message = error instanceof Error ? error.message : ''
  return name === 'AbortError' || /abort/i.test(message)
}

/** Bounded reason for an HTTP status; falls back to the generic classifier. */
function reasonForStatus(status: number | undefined, error: unknown): string {
  if (status === undefined) {
    return isAbortError(error) ? 'timeout' : classifyFailureReason(error)
  }
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate_limited'
  if (status === 408) return 'timeout'
  if (status >= 500) return 'server_error'
  if (status >= 400) return 'client_error'
  return classifyFailureReason(error)
}

/** True for failures where the receiver provably did not accept the payload. */
function isPermanentStatus(status: number | undefined): boolean {
  if (status === undefined) return false
  return status >= 400 && status < 500 && status !== 408 && status !== 429
}

/**
 * Classify one webhook delivery attempt into an operator-actionable state.
 *
 * Retryability is derived from the HTTP status first (4xx that are not 408/429
 * never succeed on retry; 429 and 5xx do), then from the transport error
 * classification, so a timeout after the request was written is treated as
 * potentially delivered rather than as a clean rejection.
 */
export function assessWebhookDelivery(
  input: WebhookDeliveryAssessmentInput,
): WebhookDeliveryAssessment {
  const statusCode = input.statusCode ?? errorStatus(input.error)
  const detail = sanitizeWebhookDetail(
    input.error instanceof Error ? input.error.message : undefined,
  )

  if (input.error === undefined && (statusCode === undefined || (statusCode >= 200 && statusCode < 300))) {
    return {
      state: 'success',
      reason: 'provider_accepted',
      retryable: false,
      mayHaveDelivered: true,
    }
  }

  const reason = reasonForStatus(statusCode, input.error)
  const permanent = isPermanentStatus(statusCode)
  const mayHaveDelivered = statusCode === undefined || statusCode >= 500

  if (permanent) {
    return {
      state: 'blocked',
      reason,
      retryable: false,
      mayHaveDelivered: false,
      detail: detail || undefined,
    }
  }

  if (input.willRetry) {
    return {
      state: 'delayed',
      reason,
      retryable: true,
      mayHaveDelivered,
      detail: detail || undefined,
    }
  }

  return {
    state: 'blocked',
    reason: `${reason}_retries_exhausted`,
    retryable: false,
    mayHaveDelivered,
    detail: detail || undefined,
  }
}

function logContext(
  input: WebhookDeliveryContext,
  assessment: WebhookDeliveryAssessment,
): Record<string, unknown> {
  const context: Record<string, unknown> = {
    source: input.source,
    provider: 'webhook',
    eventType: input.eventType,
    deliveryId: input.deliveryId,
    userId: input.userId,
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
    deliveryState: assessment.state,
    outcome: assessment.reason,
    retryable: assessment.retryable,
    mayHaveDelivered: assessment.mayHaveDelivered,
  }

  if (input.statusCode !== undefined) context.statusCode = input.statusCode
  if (input.retryAfterMs !== undefined) context.retryAfterMs = input.retryAfterMs
  if (input.nextAttemptAt !== undefined) context.nextAttemptAt = new Date(input.nextAttemptAt).toISOString()
  if (input.elapsedMs !== undefined) context.elapsedMs = input.elapsedMs
  if (assessment.detail) context.detail = assessment.detail

  return context
}

/**
 * Record the start of an attempt *before* the request is made.
 *
 * This is what makes a worker restart diagnosable: an attempt-start record with
 * no terminal record for the same `deliveryId`/`attempt` means the process died
 * mid-delivery, so the outcome must be treated as unknown rather than assumed
 * successful.
 */
export function reportWebhookDeliveryAttemptStarted(input: WebhookDeliveryContext): void {
  logger.info('Webhook delivery attempt started', {
    source: input.source,
    provider: 'webhook',
    eventType: input.eventType,
    deliveryId: input.deliveryId,
    userId: input.userId,
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
    deliveryState: 'delayed',
    phase: 'attempt_started',
  })
}

/**
 * Record the terminal outcome of an attempt and publish the matching metric.
 * Callers pass the same context used for the start record plus the error/
 * status; the assessment decides success, delayed or blocked.
 */
export function reportWebhookDeliveryOutcome(
  input: WebhookDeliveryContext,
): WebhookDeliveryAssessment {
  const assessment = assessWebhookDelivery({
    statusCode: input.statusCode,
    error: input.error,
    willRetry: input.willRetry ?? input.attempt < input.maxAttempts,
  })
  const context = logContext(input, assessment)

  if (assessment.state === 'success') {
    logger.info('Webhook delivery succeeded', context)
  } else if (assessment.state === 'delayed') {
    logger.warn('Webhook delivery delayed; retry scheduled', context)
  } else {
    logger.error('Webhook delivery blocked; operator action required', context)
  }

  try {
    recordWebhookOutcomeMetric({
      outcome: assessment.state,
      reason: assessment.reason,
      eventType: input.eventType,
    })
  } catch (error) {
    logger.warn('Failed to record webhook delivery outcome metric', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return assessment
}
