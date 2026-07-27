/**
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
