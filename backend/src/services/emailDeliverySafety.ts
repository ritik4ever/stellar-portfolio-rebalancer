import { createHash } from "node:crypto";
import {
  classifyFailureReason,
  NotificationDeliveryError,
} from "./notificationDelivery.js";

/**
 * Safety helpers for SMTP email delivery (#2091).
 *
 * A leaked SMTP response is fundamentally different from a network error: the
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

  const detail = errorMessage(error);

  if (isAmbiguousSmtpFailure(error)) {
    return new NotificationDeliveryError(
      `Email delivery outcome unknown for Message-ID ${messageId}: the SMTP server may have accepted the message before the connection failed (${detail}). Retry stopped to avoid a duplicate send.`,
      {
        kind: "ambiguous",
        reason: "delivery_unknown",
        idempotencyKey: messageId,
        cause: error,
      },
    );
  }

  if (isPermanentSmtpFailure(error)) {
    return new NotificationDeliveryError(
      `Email delivery rejected for Message-ID ${messageId}: ${detail}`,
      {
        kind: "permanent",
        reason: permanentFailureReason(error),
        idempotencyKey: messageId,
        cause: error,
      },
    );
  }

  return new NotificationDeliveryError(
    `Email delivery failed for Message-ID ${messageId}: ${detail}`,
    {
      kind: "retryable",
      reason: classifyFailureReason(error),
      idempotencyKey: messageId,
      cause: error,
    },
  );
}
