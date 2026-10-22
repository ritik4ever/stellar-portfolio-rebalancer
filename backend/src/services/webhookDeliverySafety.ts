import { createHash } from "node:crypto";
import {
  classifyFailureReason,
  NotificationDeliveryError,
} from "./notificationDelivery.js";

/**
 * Safety helpers for webhook delivery (#2096).
 *
 * A webhook request that reaches the server but times out before returning a
 * response is fundamentally different from a network error: the provider may
 * have already processed the payload. This module mirrors the SMTP safety
 * helpers in emailDeliverySafety.ts to classify failures and carry an
 * idempotency key so retries cannot silently duplicate side effects.
 */

export interface WebhookNotificationIdentity {
  userId: string;
  portfolioId?: string;
  eventType: string;
  title: string;
  timestamp: string;
}

/** HTTP client error codes that indicate the request reached the server. */
const SERVER_SIDE_ERROR_CODES = new Set([
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "ECONNRESET",
  "EPIPE",
  "ECONNABORTED",
]);

/** HTTP status codes that prove the server explicitly rejected the payload. */
const EXPLICIT_REJECTION_CODES = new Set([400, 401, 403, 404, 422, 429]);

/**
 * Deterministic idempotency key for one logical webhook notification. Every
 * retry of the same notification reuses it, so the provider (and anyone
 * reading the webhook logs) can correlate a possible duplicate with the
 * original attempt instead of treating it as a new message.
 */
export function deriveWebhookIdempotencyKey(
  identity: WebhookNotificationIdentity,
): string {
  const seed = [
    identity.userId,
    identity.portfolioId ?? "",
    identity.eventType,
    identity.timestamp,
    identity.title,
  ].join("|");
  const digest = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return `webhook:${digest}`;
}

/**
 * True when the HTTP client reached the server but the confirmation never
 * arrived (timeout / dropped connection), and no explicit rejection response
 * was seen. The provider may already have processed the payload.
 */
export function isAmbiguousWebhookFailure(
  error: unknown,
): boolean {
  const status = extractHttpStatus(error);
  // An explicit 4xx/5xx response proves the server refused the message.
  if (status !== undefined) {
    return false;
  }

  const code = extractErrorCode(error);
  if (SERVER_SIDE_ERROR_CODES.has(code)) {
    return true;
  }

  return /timeout|timed out|connection (closed|reset)|aborted/i.test(extractErrorMessage(error));
}

/**
 * True when retrying cannot help: the server explicitly rejected the message
 * (4xx client error), or the request could not be formed (invalid URL, etc.).
 * Retrying these would only add load without ever succeeding.
 */
export function isPermanentWebhookFailure(
  error: unknown,
): boolean {
  const status = extractHttpStatus(error);
  if (status !== undefined && EXPLICIT_REJECTION_CODES.has(status)) {
    return true;
  }

  const message = extractErrorMessage(error);
  if (/invalid (url|uri)|malformed (url|uri)|ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return true;
  }

  return false;
}

/**
 * Extract HTTP status code from various error shapes (fetch Response, axios, etc.).
 */
function extractHttpStatus(error: unknown): number | undefined {
  if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>;
    if (typeof obj.status === "number") return obj.status;
    if (obj.response && typeof obj.response === "object") {
      const resp = obj.response as Record<string, unknown>;
      if (typeof resp.status === "number") return resp.status;
    }
  }
  return undefined;
}

/** Extract error code (e.g., "ETIMEDOUT") from error object. */
function extractErrorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>;
    const code = obj.code;
    if (typeof code === "string") return code.toUpperCase();
  }
  return "";
}

/** Extract error message string. */
function extractErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>;
    const message = obj.message;
    if (typeof message === "string") return message;
  }
  return error instanceof Error ? error.message : String(error ?? "");
}

/**
 * Human-readable reason for a permanent webhook failure.
 */
function permanentWebhookFailureReason(error: unknown): string {
  const status = extractHttpStatus(error);
  if (status !== undefined) {
    if (status === 401 || status === 403) return "auth";
    if (status === 429) return "rate_limited";
    if (status >= 400 && status < 500) return "client_error";
  }
  const message = extractErrorMessage(error);
  if (/invalid (url|uri)/i.test(message)) return "invalid_url";
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) return "dns";
  const reason = classifyFailureReason(error);
  return reason === "unknown" ? "rejected" : reason;
}

/**
 * Convert a webhook failure into a delivery error that carries an explicit
 * retry decision and the notification's idempotency key.
 */
export function toWebhookDeliveryError(
  error: unknown,
  idempotencyKey: string,
): NotificationDeliveryError {
  if (error instanceof NotificationDeliveryError) {
    return error;
  }

  const detail = extractErrorMessage(error);

  if (isAmbiguousWebhookFailure(error)) {
    return new NotificationDeliveryError(
      `Webhook delivery outcome unknown for ${idempotencyKey}: the server may have accepted the payload before the connection failed (${detail}). Retry stopped to avoid a duplicate side effect.`,
      {
        kind: "ambiguous",
        reason: "delivery_unknown",
        idempotencyKey,
        cause: error,
      },
    );
  }

  if (isPermanentWebhookFailure(error)) {
    return new NotificationDeliveryError(
      `Webhook delivery rejected for ${idempotencyKey}: ${detail}`,
      {
        kind: "permanent",
        reason: permanentWebhookFailureReason(error),
        idempotencyKey,
        cause: error,
      },
    );
  }

  return new NotificationDeliveryError(
    `Webhook delivery failed for ${idempotencyKey}: ${detail}`,
    {
      kind: "retryable",
      reason: classifyFailureReason(error),
      idempotencyKey,
      cause: error,
    },
  );
}