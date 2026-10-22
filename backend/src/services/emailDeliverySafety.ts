import { createHash } from "node:crypto";
import {
  classifyFailureReason,
  NotificationDeliveryError,
} from "./notificationDelivery.js";

/**
 * Safety helpers for SMTP email delivery (#2091).
 *
 * A leaked ASMTP response is fundamentally different from a network error: the
 * provider may have accepted the message even though the client never saw the
 * confirmation. Nodemailer exposes the server response (if any) on the error,
 * which is enough to tell an explicit rejection from an unknown outcome.
 */

export interface EmailNotificationIdentity {
  userId: string;
  portfolioId?: string;
  eventType: string;
  title: string;
  timestamp: string;
  deliveryId?: string;
}

/**
 * Actionable delivery outcome for operators. Each outcome maps to a
 * distinct operational response:
 * - `delivered`: the provider confirmed acceptance.
 * - `delayed`: the provider temporarily deferred the message (4xx).
 * - `blocked`: the provider rejected the message or the client cannot retry.
 * - `unknown`: the provider may have accepted the message but no confirmation
 *   was received (e.g. timeout after acceptance). Retry is stopped to avoid a
 *   duplicate send.
 */
export type EmailDeliveryOutcome = "delivered" | "delayed" | "blocked" | "unknown";

export interface EmailDeliveryOutcomeReport {
  outcome: EmailDeliveryOutcome;
  /** Stable machine-readable reason code for dashboards/alerting. */
  reason: string;
  /** Whether a retry is safe and useful. */
  retryable: boolean;
  /** Deterministic idempotency key (Message-ID) for correlation. */
  idempotencyKey: string;
  /** Sanitized diagnostic detail; no secrets or credentials. */
  detail: string;
  /** SMTP transport code, when available. */
  transportCode?: string;
  /** SMTP server response code, when the server answered. */
  responseCode?: number;
  /** Operator-facing summary of the next step. */
  action: string;
}

const DEFAULT_MESSAGE_ID_DOMAIN = "stellarportfolio.com";

/**
 * Transport-level failures raised after a connection was established. The
 * message body may already be on the wire when one of these happens, so the
 * outcome is unknown unless the server sent an explicit rejection.
 */
const POSSIBLY_DELIVERED_ERROR_CODES = new Set([
  "ETIMEDOUT",
  "ESOCKET",
  "ESOCKETTIMEDOUT",
  "ECONNECTION",
  "ECONNRESET",
  "EPIPE",
]);

interface SmtpFailureLike {
  code?: unknown;
  responseCode?: unknown;
  response?: unknown;
  command?: unknown;
  message?: unknown;
}

function asSmtpFailure(error: unknown): SmtpFailureLike {
  return error && typeof error === "object" ? (error as SmtpFailureLike) : {};
}

function errorCode(error: unknown): string {
  const code = asSmtpFailure(error).code;
  return typeof code === "string" ? code.toUpperCase() : "";
}

function errorMessage(error: unknown): string {
  const { message } = asSmtpFailure(error);
  if (typeof message === "string") return message;
  return error instanceof Error ? error.message : String(error ?? "");
}

/** SMTP status from the server, when the server managed to answer. */
function smtpResponseCode(error: unknown): number | undefined {
  const { responseCode } = asSmtpFailure(error);
  return typeof responseCode === "number" ? responseCode : undefined;
}

function senderDomain(from: string | undefined): string {
  const match = from?.match(/@([^>\s,;]+)/);
  const domain = match?.[1]?.replace(/[>]+$/g, "");
  return domain && /^[a-z0-9.-]+$/i.test(domain) ? domain : DEFAULT_MESSAGE_ID_DOMAIN;
}

/**
 * Deterministic Message-ID for one logical notification. Every retry of the
 * same notification reuses it, so the provider (and anyone reading the SMTP 
 * logs) can correlate a possible duplicate with the original attempt instead of
 * treating it as a new message.
 */
export function deriveEmailMessageId(
  identity: EmailNotificationIdentity,
  from: string | undefined = process.env.SMTP_FROM,
): string {
  // Match the retry wrapper's logical identity. Presentation fields can change
  // when a producer reconstructs the same rebalance event for redelivery.
  const seed = identity.deliveryId
    ? JSON.stringify([identity.userId, identity.eventType, identity.deliveryId])
    : [
        identity.userId,
        identity.portfolioId ?? "",
        identity.eventType,
        identity.timestamp,
        identity.title,
      ].join("|");
  const digest = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return `<${digest}@${senderDomain(from)}>`;
}

/**
 * True when the SMTP server may have accepted the message but the client never
 * received the final confirmation (timeout / dropped connection), and no
 * explicit rejection response was seen.
 */
export function isAmbiguousSmtpFailure(error: unknown): boolean {
  const responseCode = smtpResponseCode(error);
  // An explicit 4xx/5xx response proves the server refused the message.
  if (responseCode !== undefined && responseCode >= 400) {
    return false;
  }

  const code = errorCode(error);
  if (POSSIBLY_DELIVERED_ERROR_CODES.has(code)) {
    return true;
  }

  return /timeout|timed out|connection (closed|reset)/i.test(errorMessage(error));
}

/**
 * True when the provider temporarily deferred the message (4xx). The sender
 * should retry later; the message was not accepted.
 */
export function isDelayedSmtpFailure(error: unknown): boolean {
  const responseCode = smtpResponseCode(error);
  return responseCode !== undefined && responseCode >= 400 && responseCode < 500;
}

/**
 * True when retrying cannot help: the server rejected the message (5xx), the
 * credentials were refused, or the address is invalid. Retrying these would
 * only add load without ever succeeding.
 */
export function isPermanentSmtpFailure(error: unknown): boolean {
  const responseCode = smtpResponseCode(error);
  if (responseCode !== undefined && responseCode >= 500 && responseCode < 600) {
    return true;
  }

  const code = errorCode(error);
  if (code === "EAUTH" || code.startsWith("EAUTH")) {
    return true;
  }

  // Nodemailer reports locally detected envelope/message problems without a
  // server response (missing/invalid recipients, empty message, ...).
  return (
    (code === "EENVELOPE" || code === "EMESSAGE") && responseCode === undefined
  );
}

function permanentFailureReason(error: unknown): string {
  const responseCode = smtpResponseCode(error);
  if (responseCode !== undefined && responseCode >= 500) return "rejected";

  const message = errorMessage(error);
  if (/recipient|address/i.test(message)) return "invalid_recipient";

  const reason = classifyFailureReason(error);
  return reason === "unknown" ? "rejected" : reason;
}

/**
 * Strip known secret-bearing patterns from a diagnostic detail string so the
 * operator report never leaks credentials or auth tokens into logs.
 */
export function sanitizeEmailDeliveryDetail(detail: string): string {
  return detail
    .replace(/\b(auth?=[^\s]+)/gi, "auth=[redacted]")
    .replace(/\b(password=[^\s]+)/gi, "password=[redacted]")
    .replace(/\buser(?:name)?=[^\s]+/gi, "user=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/g, "Bearer [redacted]")
    .replace(/Basic\s+[A-Za-z0-9._~-]+=*/g, "Basic [redacted]")
    .replace(/\b[a-z0-9._%-]+@[a-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[redacted-address]");
}

/**
 * Build an operator-facing report describing the delivery outcome for a
 * failed SMTP attempt. The report distinguishes success (confirmed), delay
 * (temporary deferral), blocked (permanent rejection), and unknown (possible
 * acceptance with no confirmation). It includes the Message-ID and a
 * sanitized detail so operators can diagnose the provider timing out after
 * accepting a message without exposing secrets.
 */
export function reportEmailDeliveryOutcome(
  error: unknown,
  messageId: string,
  options: { delivered?: boolean } = {},
): EmailDeliveryOutcomeReport {
  const detail = sanitizeEmailDeliveryDetail(errorMessage(error));
  const transportCode = errorCode(error) || undefined;
  const responseCode = smtpResponseCode(error);

  if (options.delivered) {
    return {
      outcome: "delivered",
      reason: "accepted",
      retryable: false,
      idempotencyKey: messageId,
      detail,
      transportCode,
      responseCode,
      action: "No action needed; the provider confirmed acceptance.",
    };
  }

  if (isAmbiguousSmtpFailure(error)) {
    return {
      outcome: "unknown",
      reason: "delivery_unknown",
      retryable: false,
      idempotencyKey: messageId,
      detail,
      transportCode,
      responseCode,
      action:
        "Check the provider delivery logs for this Message-ID before resending; the message may already have been accepted.",
    };
  }

  if (isDelayedSmtpFailure(error)) {
    return {
      outcome: "delayed",
      reason: "deferred",
      retryable: true,
      idempotencyKey: messageId,
      detail,
      transportCode,
      responseCode,
      action:
        "Schedule a retry with backoff; the provider temporarily deferred the message.",
    };
  }

  if (isPermanentSmtpFailure(error)) {
    return {
      outcome: "blocked",
      reason: permanentFailureReason(error),
      retryable: false,
      idempotencyKey: messageId,
      detail,
      transportCode,
      responseCode,
      action:
        "Fix the recipient address or SMTP credentials; retrying without a change will not succeed.",
    };
  }

  return {
    outcome: "delayed",
    reason: classifyFailureReason(error),
    retryable: true,
    idempotencyKey: messageId,
    detail,
    transportCode,
    responseCode,
    action:
      "Retry with backoff; the failure is transient and no explicit rejection was received.",
  };
}

/**
 * Convert an SMTP failure into a delivery error that carries an explicit retry
 * decision and the notification's idempotency key.
 */
export function toEmailDeliveryError(
  error: unknown,
  messageId: string,
): NotificationDeliveryError {
  if (error instanceof NotificationDeliveryError) {
    return error;
  }

  const report = reportEmailDeliveryOutcome(error, messageId);
  const detail = report.detail;

  if (report.outcome === "unknown") {
    return new NotificationDeliveryError(
      `Email delivery outcome unknown for Message-ID ${messageId}: the SMTP server may have accepted the message before the connection failed (${detail}). Retry stopped to avoid a duplicate send. ${report.action}`,
      {
        kind: "ambiguous",
        reason: "delivery_unknown",
        idempotencyKey: messageId,
        cause: error,
      },
    );
  }

  if (report.outcome === "blocked") {
    return new NotificationDeliveryError(
      `Email delivery rejected for Message-ID ${messageId}: ${detail}. ${report.action}`,
      {
        kind: "permanent",
        reason: report.reason,
        idempotencyKey: messageId,
        cause: error,
      },
    );
  }

  return new NotificationDeliveryError(
    `Email delivery failed for Message-ID ${messageId}: ${detail}. ${report.action}`,
    {
      kind: "retryable",
      reason: report.reason,
      idempotencyKey: messageId,
      cause: error,
    },
  );
}
