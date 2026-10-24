/*
 * Provider-specific delivery backoff policies for email and webhook notifications.
 * Loaded from environment variables and validated at startup.
 */

export interface DeliveryBackoffPolicy {
  /** Total delivery attempts including the first try (minimum 1). */
  maxAttempts: number
  /** Delay before the first retry, in milliseconds. */
  initialBackoffMs: number
  /** Upper bound for computed backoff delay between retries. */
  maxBackoffMs: number
  /** Exponential multiplier applied per retry (1 = fixed delay). */
  backoffMultiplier: number
  /** Outbound request timeout (webhook only). */
  requestTimeoutMs?: number
}

export interface NotificationDeliveryConfig {
  email: DeliveryBackoffPolicy
  webhook: DeliveryBackoffPolicy
}

export type EmailDeliveryOutcomeStatus = "delivered" | "delayed" | "blocked"

export interface EmailDeliveryOutcome {
  /** Classified outcome for operator triage. */
  status: EmailDeliveryOutcomeStatus
  /** Stable machine-readable reason code for the classification. */
  reason: string
  /** Number of attempts consumed by this delivery. */
  attempts: number
  /** Total attempts allowed by the effective policy. */
  maxAttempts: number
  /** Time spent in the delivery attempt, in milliseconds. */
  elapsedMs?: number
  /** Scheduled backoff before the next retry, in milliseconds. */
  nextRetryDelayMs?: number
  /** Whether the provider acknowledged acceptance of the message. */
  providerAccepted?: boolean
  /** Whether the failure is considered retryable. */
  retryable?: boolean
  /** San-itized detail for diagnosis (no secrets / payloads). */
  detail?: string
}

export type EmailDeliverySignal = {
  /** Outcome of the attempt as reported by the transport. */
  outcome: "accepted" | "timeout" | "rejected" | "transient_error" | "blocked"
  /** Number of attempts consumed so far. */
  attempts: number
  /** Time spent in the attempt, in milliseconds. */
  elapsedMs?: number
  /** Whether the provider acknowledged acceptance before the failure. */
  providerAccepted?: boolean
  /** San-itized detail for diagnosis (no secrets / payloads). */
  detail?: string
}

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  fieldName: string,
  errors: string[],
  min = 1,
): number {
  if (value === undefined || value.trim() === "") {
    return fallback
  }
  const parsed = Number.parseInt(value.trim(), 10)
  if (!Number.isInteger(parsed) || parsed < min) {
    errors.push(
      `${fieldName} '${value}' is invalid. Provide an integer >= ${min}.`,
    )
    return fallback
  }
  return parsed
}

function parseNonNegativeInt(
  value: string | undefined,
  fallback: number,
  fieldName: string,
  errors: string[],
): number {
  if (value === undefined || value.trim() === "") {
    return fallback
  }
  const parsed = Number.parseInt(value.trim(), 10)
  if (!Number.isInteger(parsed) || parsed < 0) {
    errors.push(
      `${fieldName} '${value}' is invalid. Provide a non-negative integer.`,
    )
    return fallback
  }
  return parsed
}

function parseMultiplier(
  value: string | undefined,
  fallback: number,
  fieldName: string,
  errors: string[],
): number {
  if (value === undefined || value.trim() === "") {
    return fallback
  }
  const parsed = Number.parseFloat(value.trim())
  if (!Number.isFinite(parsed) || parsed < 1) {
    errors.push(
      `${fieldName} '${value}' is invalid. Provide a number >= 1.`,
    )
    return fallback
  }
  return parsed
}

/**
 * Delay before retry `retryIndex` (0 = first retry after initial failure).
 */
export function computeBackoffDelayMs(
  policy: DeliveryBackoffPolicy,
  retryIndex: number,
): number {
  if (retryIndex <= 0) {
    return policy.initialBackoffMs
  }
  const scaled =
    policy.initialBackoffMs * policy.backoffMultiplier ** retryIndex
  return Math.min(Math.round(scaled), policy.maxBackoffMs)
}

/**
 * Classify an email delivery signal into an actionable outcome for operators.
 *
 * - delivered: the provider accepted the message.
 * - delayed: the attempt failed but is retryable and retries remain.
 * - blocked: the attempt failed permanently or retries are exhausted.
 *
 * The signal is expected to be san-itized by the caller (no secrets, no
 * message body). This function only decides the classification and the
 * context operators need to distinguish the three states.
 */
export function classifyEmailDeliveryOutcome(
  signal: EmailDeliverySignal,
  policy: DeliveryBackoffPolicy,
): EmailDeliveryOutcome {
  const attempts = Math.max(1, Math.trunc(signal.attempts))
  const maxAttempts = Math.max(1, policy.maxAttempts)
  const remainingAttempts = maxAttempts - attempts
  const base = {
    attempts,
    maxAttempts,
    elapsedMs: signal.elapsedMs,
    providerAccepted: signal.providerAccepted,
    detail: signal.detail,
  }

  if (signal.outcome === "accepted") {
    return {
      ...base,
      status: "delivered",
      reason: "provider_accepted",
      retryable: false,
    }
  }

  if (signal.outcome === "blocked") {
    return {
      ...base,
      status: "blocked",
      reason: "provider_blocked",
      retryable: false,
    }
  }

  if (signal.outcome === "rejected") {
    return {
      ...base,
      status: "blocked",
      reason: "provider_rejected",
      retryable: false,
    }
  }

  // Timeout after the provider accepted the message is ambiguous: the
  // message may have been delivered, but we never saw the acknowledgement.
  // Surface it as a retryable delay while retries remain, and as blocked
  // once they are exhausted, so operators can distinguish it from a clean
  // success or a hard rejection.
  const retryable = remainingAttempts > 0
  const reason =
    signal.outcome === "timeout"
      ? signal.providerAccepted
        ? "timeout_after_accept"
        : "timeout"
      : "transient_error"

  if (retryable) {
    return {
      ...base,
      status: "delayed",
      reason,
      retryable: true,
      nextRetryDelayMs: computeBackoffDelayMs(policy, attempts - 1),
    }
  }

  return {
    ...base,
    status: "blocked",
    reason: `${reason}_retries_exhausted`,
    retryable: false,
  }
}

export function parseNotificationDeliveryConfig(
  env: NodeJS.ProcessEnv = process.env,
): { config: NotificationDeliveryConfig; errors: string[] } {
  const errors: string[] = []

  const webhookRetryCount = parseNonNegativeInt(
    env.WEBHOOK_RETRY_COUNT,
    1,
    "WEBHOOK_RETRY_COUNT",
    errors,
  )
  const webhookMaxAttempts = Math.max(
    1,
    1 + (Number.isInteger(webhookRetryCount) ? webhookRetryCount : 1),
  )

  const emailMaxAttempts = parsePositiveInt(
    env.EMAIL_MAX_ATTEMPTS,
    3,
    "EMAIL_MAX_ATTEMPTS",
    errors,
  )

  const config: NotificationDeliveryConfig = {
    email: {
      maxAttempts: emailMaxAttempts,
      initialBackoffMs: parsePositiveInt(
        env.EMAIL_INITIAL_BACKOFF_MS,
        1000,
        "EMAIL_INITIAL_BACKOFF_MS",
        errors,
      ),
      maxBackoffMs: parsePositiveInt(
        env.EMAIL_MAX_BACKOFF_MS,
        30_000,
        "EMAIL_MAX_BACKOFF_MS",
        errors,
      ),
      backoffMultiplier: parseMultiplier(
        env.EMAIL_BACKOFF_MULTIPLIER,
        2,
        "EMAIL_BACKOFF_MULTIPLIER",
        errors,
      ),
    },
    webhook: {
      maxAttempts: webhookMaxAttempts,
      initialBackoffMs: parsePositiveInt(
        env.WEBHOOK_RETRY_DELAY,
        1000,
        "WEBHOOK_RETRY_DELAY",
        errors,
      ),
      maxBackoffMs: parsePositiveInt(
        env.WEBHOOK_MAX_BACKOFF_MS,
        60_000,
        "WEBHOOK_MAX_BACKOFF_MS",
        errors,
      ),
      backoffMultiplier: parseMultiplier(
        env.WEBHOOK_BACKOFF_MULTIPLIER,
        2,
        "WEBHOOK_BACKOFF_MULTIPLIER",
        errors,
      ),
      requestTimeoutMs: parsePositiveInt(
        env.WEBHOOK_TIMEOUT,
        5000,
        "WEBHOOK_TIMEOUT",
        errors,
      ),
    },
  }

  if (config.email.initialBackoffMs > config.email.maxBackoffMs) {
    errors.push(
      "EMAIL_INITIAL_BACKOFF_MS cannot be greater than EMAIL_MAX_BACKOFF_MS.",
    )
  }
  if (config.webhook.initialBackoffMs > config.webhook.maxBackoffMs) {
    errors.push(
      "WEBHOOK_RETRY_DELAY cannot be greater than WEBHOOK_MAX_BACKOFF_MS.",
    )
  }

  return { config, errors }
}

export function getNotificationDeliveryConfig(
  env: NodeJS.ProcessEnv = process.env,
): NotificationDeliveryConfig {
  return parseNotificationDeliveryConfig(env).config
}
