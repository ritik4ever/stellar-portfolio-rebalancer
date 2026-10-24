import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { logger } from "../utils/logger.js";
import {
  dbSaveNotificationPreferences,
  dbGetNotificationPreferences,
  dbGetAllNotificationPreferences,
  dbLogNotificationOutcome,
  dbGetNotificationLogs,
  dbGetLatestNotificationLog,
  dbSaveDigestEvent,
  dbGetAndDeleteDigestEventsBefore,
  dbInitDefaultNotificationPreferences,
  dbGetPortfolioNotificationOverride,
  dbSavePortfolioNotificationOverride,
  dbListPortfolioNotificationOverrides,
  dbDeletePortfolioNotificationOverride,
  dbSaveSmsVerification,
  dbGetSmsVerification,
  dbConfirmSmsVerification,
  type PortfolioNotificationOverride,
  type NotificationPreferences,
  type NotificationLog,
} from "../db/notificationDb.js";
import nodemailer, { type Transporter } from "nodemailer";
import {
  normalizeNotificationPreferences,
  notificationPreferencesSchema,
  resolvePortfolioNotificationPreferences,
} from "./notificationPreferences.js";
import { databaseService } from "./databaseService.js";
import {
  getNotificationDeliveryConfig,
  type NotificationDeliveryConfig,
} from "../config/notificationDeliveryConfig.js";
import { deliverWithBackoff } from "./notificationDelivery.js";
import {
  redactWebhookEndpoint,
  reportWebhookDeliveryAttemptStarted,
  reportWebhookDeliveryOutcome,
} from "./webhookDeliveryOutcome.js";
import { deriveEmailMessageId, toEmailDeliveryError } from "./emailDeliverySafety.js";
import { deriveWebhookDeliveryId, isAmbiguousWebhookFailure, toWebhookDeliveryError } from "./webhookDeliverySafety.js";
import { webhookDeadLetterQueue, type DeadLetterItem } from "./webhookDeadLetter.js";
import { sendSlackNotification } from '../notifications/slack.js'
import { createTwilioClient, generateVerificationCode, hashVerificationCode, normalizePhoneNumber, sendSms, verifyCodeHash, type SmsClient } from '../notifications/sms.js'


export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

export interface NotificationPayload {
  userId: string;
 
  portfolioId?: string;
  eventType: "rebalance" | "circuitBreaker" | "priceMovement" | "riskChange" | "correlation_breakdown" | "digest";
  title: string;
  message: string;
  data?: any;
  timestamp: string;
  deliveryId?: string;
  signal?: AbortSignal;
}



interface NotificationProvider {
  send(
    payload: NotificationPayload,
    preferences: NotificationPreferences,
  ): Promise<void>;
}

class SlackProvider implements NotificationProvider {
  constructor(private readonly deliveryConfig: NotificationDeliveryConfig) {}
  async send(payload: NotificationPayload, preferences: NotificationPreferences): Promise<void> {
    if (!preferences.slackEnabled || !preferences.slackWebhookUrl) {
      dbLogNotificationOutcome(payload.userId, 'slack', payload.eventType, 'skipped', 'Slack disabled or missing URL')
      return
    }
    await sendSlackNotification(preferences.slackWebhookUrl, payload, this.deliveryConfig.webhook)
  }
}

class SmsProvider implements NotificationProvider {
  private readonly sentAt = new Map<string, number[]>()
  constructor(private readonly client: SmsClient | null, private readonly deliveryConfig: NotificationDeliveryConfig) {}
  async send(payload: NotificationPayload, preferences: NotificationPreferences): Promise<void> {
    if (!preferences.smsEnabled || !preferences.phoneVerified || !preferences.phoneNumber || !this.client) {
      dbLogNotificationOutcome(payload.userId, 'sms', payload.eventType, 'skipped', 'SMS disabled, unverified, or missing config')
      return
    }
    const critical = payload.eventType === 'circuitBreaker' || payload.eventType === 'riskChange' || payload.eventType === 'correlation_breakdown'
    if (!critical) return
    const cutoff = Date.now() - 60 * 60 * 1000
    const recent = (this.sentAt.get(payload.userId) ?? []).filter((at) => at > cutoff)
    if (recent.length >= 5) {
      dbLogNotificationOutcome(payload.userId, 'sms', payload.eventType, 'skipped', 'Hourly SMS rate limit reached')
      return
    }
    await sendSms(this.client, { userId: payload.userId, phone: preferences.phoneNumber, eventType: payload.eventType, body: `${payload.title}: ${payload.message}` }, { ...this.deliveryConfig.webhook, maxAttempts: 1 })
    recent.push(Date.now())
    this.sentAt.set(payload.userId, recent)
  }
}



/**
 * Attach the receiver's HTTP status to a delivery error without changing how
 * the generic retry layer classifies throwables (it treats plain errors as
 * retryable, and the webhook retry policy stays as it was).
 */
function webhookResponseError(status: number): Error {
  const error = new Error(`Webhook responded with status ${status}`) as Error & { status: number };
  error.status = status;
  return error;
}

function webhookStatusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

class WebhookProvider implements NotificationProvider {
  constructor(private readonly deliveryConfig: NotificationDeliveryConfig) {}

  async send(
    payload: NotificationPayload,
    preferences: NotificationPreferences,
  ): Promise<void> {
    if (!preferences.webhookEnabled || !preferences.webhookUrl) {
      dbLogNotificationOutcome(
        payload.userId,
        "webhook",
        payload.eventType,
        "skipped",
        "Webhook disabled or missing URL",
      );
      return;
    }

    const policy = {
      ...this.deliveryConfig.webhook,
      maxAttempts: Math.min(this.deliveryConfig.webhook.maxAttempts, 5),
    };

    const webhookPayload = {
      event: payload.eventType,
      title: payload.title,
      message: payload.message,
      data: payload.data,
      timestamp: payload.timestamp,
      userId: payload.userId,
    };

    const webhookUrl = preferences.webhookUrl;
    // Redacted destination, safe for logs/metrics: the URL path usually holds
    // the receiver's capability token.
    const source = redactWebhookEndpoint(webhookUrl);
    const payloadDeliveryId = payload.deliveryId;
    // Stable for every retry and for a later dead-letter replay; the receiver
    // uses it to treat a repeated POST as the same notification.
    const webhookDeliveryId =
      payloadDeliveryId ??
      deriveWebhookDeliveryId({
        userId: payload.userId,
        eventType: payload.eventType,
        timestamp: payload.timestamp,
        title: payload.title,
      });

    let attemptsMade = 0;

    try {
      await deliverWithBackoff(
        {
          provider: "webhook",
          userId: payload.userId,
          eventType: payload.eventType,
          policy,
          deliveryId: payloadDeliveryId,
          signal: payload.signal,
        },
        async (attempt) => {
          attemptsMade++;
          const startedAt = Date.now();

          // Recorded before the request so a worker restart between send and
          // acknowledgement is diagnosable (start without a terminal record).
          reportWebhookDeliveryAttemptStarted({
            source,
            eventType: payload.eventType,
            deliveryId: webhookDeliveryId,
            userId: payload.userId,
            attempt,
            maxAttempts: policy.maxAttempts,
          });

          const controller = new AbortController();
          const timeout = policy.requestTimeoutMs || 5000;
          const timeoutId = setTimeout(() => controller.abort(), timeout);

          try {
            const response = await fetch(webhookUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Event': payload.eventType,
                'X-Webhook-Delivery-Id': webhookDeliveryId,
              },
              body: JSON.stringify(webhookPayload),
              signal: controller.signal,
            });

            if (!response.ok) {
              // Keep the delivery retry policy unchanged (the generic layer
              // still classifies this as retryable) but carry the status on the
              // error so the operator outcome can tell a 503 delay apart from a
              // 400 that will never succeed.
              throw webhookResponseError(response.status);
            }
            reportWebhookDeliveryOutcome({
              source,
              eventType: payload.eventType,
              deliveryId: webhookDeliveryId,
              userId: payload.userId,
              attempt,
              maxAttempts: policy.maxAttempts,
              statusCode: response.status,
              elapsedMs: Date.now() - startedAt,
            });
          } catch (error) {
            reportWebhookDeliveryOutcome({
              source,
              eventType: payload.eventType,
              deliveryId: webhookDeliveryId,
              userId: payload.userId,
              attempt,
              maxAttempts: policy.maxAttempts,
              statusCode: webhookStatusOf(error),
              error,
              elapsedMs: Date.now() - startedAt,
            });
            // Timeouts/socket resets after the request was dispatched are
            // classified as ambiguous so the delivery is stopped instead of
            // retried against an endpoint that may already have it.
            throw toWebhookDeliveryError(error, webhookDeliveryId);
          } finally {
            clearTimeout(timeoutId);
          }
        },
      );
    } catch (error) {
      // A timeout or dropped socket after the request was dispatched leaves the
      // outcome unknown: the endpoint may already have processed the payload.
      // Queueing it for replay would risk duplicating that side effect, so the
      // `uncertain` delivery log row stays the single record of this attempt.
      if (isAmbiguousWebhookFailure(error)) {
        logger.error(
          "[Webhook] Delivery outcome unknown; not moving to the dead-letter queue to avoid a duplicate replay",
          {
            userId: payload.userId,
            eventType: payload.eventType,
            deliveryId: webhookDeliveryId,
            webhookUrl,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        return;
      }

      const deadLetterItem: DeadLetterItem = {
        id: randomBytes(16).toString('hex'),
        payload: webhookPayload,
        errorMessage:
          error instanceof Error
            ? error.message
            : `Webhook delivery failed after ${attemptsMade} attempt(s)`,
        attemptsExhausted: attemptsMade,
        stoppedEarly: attemptsMade < policy.maxAttempts,
        deliveryId: webhookDeliveryId,
        timestamp: new Date().toISOString(),
        webhookUrl,
        userId: payload.userId,
        eventType: payload.eventType,
      };
      await webhookDeadLetterQueue.push(deadLetterItem);
    }
  }
}

// ─────────────────────────────────────────────
// Email Provider (Nodemailer)
// ─────────────────────────────────────────────

class EmailProvider implements NotificationProvider {
  private transporter: Transporter | null = null;
  private warnLogged = false

  constructor(private readonly deliveryConfig: NotificationDeliveryConfig) {
    this.initializeTransporter();
  }

  isAvailable(): boolean {
    return this.transporter !== null
  }

  private initializeTransporter() {
    const emailConfig = {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    };

    logger.info("Initializing email provider", {
      host: emailConfig.host,
      port: emailConfig.port,
      user: emailConfig.auth.user,
      hasPass: !!emailConfig.auth.pass,
      maxAttempts: this.deliveryConfig.email.maxAttempts,
      initi