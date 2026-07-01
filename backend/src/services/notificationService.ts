import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { logger } from "../utils/logger.js";
import {
  dbSaveNotificationPreferences,
  dbGetNotificationPreferences,
  dbGetAllNotificationPreferences,
  dbLogNotificationOutcome,
  dbGetNotificationLogs,
  dbSaveDigestEvent,
  dbGetAndDeleteDigestEventsBefore,
  dbInitDefaultNotificationPreferences,
  type NotificationPreferences,
  type NotificationLog,
} from "../db/notificationDb.js";
import nodemailer from "nodemailer";
import { normalizeNotificationPreferences } from "./notificationPreferences.js";
import {
  getNotificationDeliveryConfig,
  type NotificationDeliveryConfig,
} from "../config/notificationDeliveryConfig.js";
import { deliverWithBackoff } from "./notificationDelivery.js";
import { webhookDeadLetterQueue, type DeadLetterItem } from "./webhookDeadLetter.js";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface NotificationPayload {
  userId: string;
  eventType: "rebalance" | "circuitBreaker" | "priceMovement" | "riskChange" | "digest";
  title: string;
  message: string;
  data?: any;
  timestamp: string;
}

// ─────────────────────────────────────────────
// Provider Interface
// ─────────────────────────────────────────────

interface NotificationProvider {
  send(
    payload: NotificationPayload,
    preferences: NotificationPreferences,
  ): Promise<void>;
}

// ─────────────────────────────────────────────
// Webhook Provider
// ─────────────────────────────────────────────

class WebhookProvider implements NotificationProvider {
  constructor(private readonly deliveryConfig: NotificationDeliveryConfig) {}

  async send(
    payload: NotificationPayload,
    preferences: NotificationPreferences,
  ): Promise<void> {
    if (!preferences.webhookEnabled || !preferences.webhookUrl) {
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

    try {
      await deliverWithBackoff(
        {
          provider: "webhook",
          userId: payload.userId,
          eventType: payload.eventType,
          policy,
        },
        async () => {
          const controller = new AbortController();
          const timeout = policy.requestTimeoutMs || 5000;
          const timeoutId = setTimeout(() => controller.abort(), timeout);

          try {
            const response = await fetch(webhookUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Event': payload.eventType,
              },
              body: JSON.stringify(webhookPayload),
              signal: controller.signal,
            });

            if (!response.ok) {
              throw new Error(`Webhook responded with status ${response.status}`);
            }
          } finally {
            clearTimeout(timeoutId);
          }
        },
      );
    } catch {
      const deadLetterItem: DeadLetterItem = {
        id: randomBytes(16).toString('hex'),
        payload: webhookPayload,
        errorMessage: 'Exhausted all webhook retry attempts',
        attemptsExhausted: policy.maxAttempts,
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
  private transporter: nodemailer.Transporter | null = null;
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
      initialBackoffMs: this.deliveryConfig.email.initialBackoffMs,
    });

    if (emailConfig.host && emailConfig.auth.user && emailConfig.auth.pass) {
      try {
        this.transporter = nodemailer.createTransport(emailConfig);
        logger.info("Email provider initialized with Nodemailer", {
          host: emailConfig.host,
          port: emailConfig.port,
        });
      } catch (error) {
        logger.error("Failed to initialize email provider", {
          error: error instanceof Error ? error.message : String(error),
        });
        this.warnLogged = true
      }
    } else {
      if (!this.warnLogged) {
        logger.warn("Email configuration incomplete - SMTP_PASS, SMTP_HOST, and SMTP_USER are required for email delivery", {
          hasHost: !!emailConfig.host,
          hasUser: !!emailConfig.auth.user,
          hasPass: !!emailConfig.auth.pass,
        });
        this.warnLogged = true
      }
    }
  }

  async send(
    payload: NotificationPayload,
    preferences: NotificationPreferences,
  ): Promise<void> {
    if (!preferences.emailEnabled || !this.transporter) {
      logger.info("Email notification skipped", {
        emailEnabled: preferences.emailEnabled,
        hasTransporter: !!this.transporter,
        userId: preferences.userId,
      });
      dbLogNotificationOutcome(
        payload.userId,
        "email",
        payload.eventType,
        "skipped",
        "Email disabled or missing config",
      );
      return;
    }

    const recipientEmail = preferences.emailAddress;

    if (!recipientEmail || !recipientEmail.includes("@")) {
      logger.warn("No valid email address for user", {
        userId: preferences.userId,
      });
      dbLogNotificationOutcome(
        payload.userId,
        "email",
        payload.eventType,
        "skipped",
        "No valid email address",
      );
      return;
    }

    const mailOptions = {
      from: process.env.SMTP_FROM || "noreply@stellarportfolio.com",
      to: recipientEmail,
      subject: `[Stellar Portfolio] ${payload.title}`,
      text: this.formatTextEmail(payload),
      html: this.formatHtmlEmail(payload),
    };

    const policy = this.deliveryConfig.email;

    await deliverWithBackoff(
      {
        provider: "email",
        userId: payload.userId,
        eventType: payload.eventType,
        policy,
      },
      async () => {
        const info = await this.transporter!.sendMail(mailOptions);
        logger.info("Email notification sent successfully", {
          to: recipientEmail,
          event: payload.eventType,
          userId: payload.userId,
          messageId: info.messageId,
          maxAttempts: policy.maxAttempts,
        });
      },
    );
  }

  async sendRaw(options: { to: string; subject: string; html: string; text: string }): Promise<void> {
    if (!this.transporter) {
      logger.warn("Cannot send raw email - transporter not available");
      return;
    }

    const mailOptions = {
      from: process.env.SMTP_FROM || "noreply@stellarportfolio.com",
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    };

    const info = await this.transporter.sendMail(mailOptions);
    logger.info("Raw email sent successfully", {
      to: options.to,
      subject: options.subject,
      messageId: info.messageId,
    });
  }

  private formatTextEmail(payload: NotificationPayload): string {
    return `
${payload.title}

${payload.message}

Event Type: ${payload.eventType}
Time: ${payload.timestamp}

---
Stellar Portfolio Rebalancer
        `.trim();
  }

  private formatHtmlEmail(payload: NotificationPayload): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #3B82F6; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
        .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>${payload.title}</h2>
        </div>
        <div class="content">
            <p>${payload.message}</p>
            <p><strong>Event Type:</strong> ${payload.eventType}</p>
            <p><strong>Time:</strong> ${payload.timestamp}</p>
        </div>
        <div class="footer">
            <p>Stellar Portfolio Rebalancer</p>
        </div>
    </div>
</body>
</html>
        `.trim();
  }
}

// ─────────────────────────────────────────────
// Notification Service
// ─────────────────────────────────────────────

export class NotificationService {
  private providers: NotificationProvider[] = [];
  private readonly deliveryConfig: NotificationDeliveryConfig;

  constructor(deliveryConfig: NotificationDeliveryConfig = getNotificationDeliveryConfig()) {
    this.deliveryConfig = deliveryConfig;
    this.providers.push(new WebhookProvider(deliveryConfig));
    this.providers.push(new EmailProvider(deliveryConfig));

    logger.info("Notification service initialized", {
      providerCount: this.providers.length,
      emailMaxAttempts: deliveryConfig.email.maxAttempts,
      webhookMaxAttempts: deliveryConfig.webhook.maxAttempts,
      webhookTimeoutMs: deliveryConfig.webhook.requestTimeoutMs,
    });
  }

  getDeliveryConfig(): NotificationDeliveryConfig {
    return this.deliveryConfig;
  }

  isEmailTransportAvailable(): boolean {
    const emailProvider = this.providers.find(
      (p) => p instanceof EmailProvider
    ) as EmailProvider | undefined
    const transporterReady = emailProvider?.isAvailable() ?? false
    const envConfigPresent = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
    return transporterReady || envConfigPresent
  }

  /**
   * Subscribe or update notification preferences
   */
  subscribe(preferences: NotificationPreferences): void {
    dbSaveNotificationPreferences(normalizeNotificationPreferences(preferences));

    logger.info("User subscribed to notifications", {
      userId: preferences.userId,
      emailEnabled: preferences.emailEnabled,
      webhookEnabled: preferences.webhookEnabled,
    });
  }

  /**
   * Get user preferences, auto-initializing with defaults if none exist.
   */
  getPreferences(
    userId: string,
  ): NotificationPreferences {
    const existing = dbGetNotificationPreferences(userId);
    if (existing) return existing;
    logger.info('[NOTIFICATION] Initializing default preferences for new user', { userId });
    return dbInitDefaultNotificationPreferences(userId);
  }

  /**
   * Unsubscribe user from all notifications
   */
  unsubscribe(userId: string): void {
    const prefs = this.getPreferences(userId);
    prefs.emailEnabled = false;
    prefs.webhookEnabled = false;
    dbSaveNotificationPreferences(prefs);
    logger.info("User unsubscribed from notifications", { userId });
  }

  /**
   * Send notification to user
   */
  async notify(payload: NotificationPayload): Promise<void> {
    const preferences = this.getPreferences(payload.userId);

    const eventKey = payload.eventType as keyof typeof preferences.events;
    if (!preferences.events[eventKey]) {
      logger.info("User has disabled notifications for this event type", {
        userId: payload.userId,
        eventType: payload.eventType,
      });
      return;
    }

    const promises = this.providers.map(async (provider) => {
      try {
        await provider.send(payload, preferences);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error("Provider failed to send notification", {
          provider: provider.constructor.name,
          userId: payload.userId,
          eventType: payload.eventType,
          error: errorMessage,
        });
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Process queued digest events for a given mode ('daily'|'weekly').
   * This will retrieve events up to now, group by user, and send a single digest per user
   * if the user's preference matches the requested mode. Events for users who don't
   * match are re-queued.
   */
  async processDigests(mode: 'daily' | 'weekly'): Promise<void> {
    const cutoff = new Date().toISOString()
    const events = dbGetAndDeleteDigestEventsBefore(cutoff)

    const byUser: Record<string, typeof events> = {}
    for (const ev of events) {
      byUser[ev.user_id] = byUser[ev.user_id] || []
      byUser[ev.user_id].push(ev)
    }

    for (const [userId, userEvents] of Object.entries(byUser)) {
      try {
        const prefs = this.getPreferences(userId)
        if (!prefs) {
          logger.info('Skipping digest for user without preferences', { userId })
          continue
        }

        if ((prefs as any).digestMode !== mode) {
          // Re-queue events (preserve them for the correct schedule)
          for (const ev of userEvents) {
            dbSaveDigestEvent(ev.user_id, ev.event_type, ev.title, ev.message, ev.data ? JSON.parse(ev.data) : undefined)
          }
          continue
        }

        // Build digest payload
        const digestTitle = `${mode.charAt(0).toUpperCase() + mode.slice(1)} Digest (${userEvents.length} events)`
        const digestMessage = userEvents
          .map((e) => `- [${e.event_type}] ${e.title} (${e.created_at})\n${e.message}`)
          .join('\n\n')

        const payload: NotificationPayload = {
          userId,
          eventType: 'digest',
          title: digestTitle,
          message: digestMessage,
          data: { events: userEvents.map((e) => ({ eventType: e.event_type, title: e.title, message: e.message, data: e.data ? JSON.parse(e.data) : undefined, timestamp: e.created_at })) },
          timestamp: new Date().toISOString(),
        }

        // Send digest through providers
        const promises = this.providers.map(async (provider) => {
          try {
            await provider.send(payload, prefs)
          } catch (error) {
            logger.error('Failed to send digest via provider', { provider: provider.constructor.name, userId, error: error instanceof Error ? error.message : String(error) })
          }
        })
        await Promise.allSettled(promises)
      } catch (error) {
        logger.error('Error processing digest for user', { userId, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  /**
   * Send a raw email directly through the email provider without
   * wrapping it in a NotificationPayload. Used by the digest module
   * for portfolio summary emails.
   */
  async sendRawEmail(options: { to: string; subject: string; html: string; text: string }): Promise<void> {
    const emailProvider = this.providers.find(
      (p) => p instanceof EmailProvider
    ) as EmailProvider | undefined;

    if (!emailProvider) {
      logger.warn("Email provider not available for raw email");
      return;
    }

    await emailProvider.sendRaw(options);
  }

  /**
   * Verify an unsubscribe token (HMAC-SHA256 of userId).
   * Used by the digest unsubscribe link to allow one-click unsubscribes
   * without requiring a JWT.
   */
  static verifyUnsubscribeToken(userId: string, token: string): boolean {
    const secret = process.env.UNSUBSCRIBE_SECRET || process.env.SMTP_PASS || 'stellar-unsubscribe-key'
    const expected = createHmac('sha256', secret).update(userId).digest('hex')
    try {
      return timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'))
    } catch {
      return false
    }
  }

  /**
   * Verify an incoming webhook callback signature.
   * Expects the X-Signature-256 header in the format `sha256=<hex>`.
   * Uses timing-safe comparison to prevent timing attacks.
   */
  static verifyCallbackSignature(
    rawBody: string,
    signatureHeader: string | undefined,
    secret: string | undefined,
  ): boolean {
    if (!signatureHeader || !secret) {
      logger.warn("Webhook callback verification skipped: missing signature or secret");
      return false;
    }

    const prefix = "sha256=";
    if (!signatureHeader.startsWith(prefix)) {
      logger.warn("Webhook callback verification failed: invalid signature format");
      return false;
    }

    const receivedSig = signatureHeader.slice(prefix.length);
    if (!/^[a-f0-9]{64}$/i.test(receivedSig)) {
      logger.warn("Webhook callback verification failed: malformed signature hex");
      return false;
    }

    const hmac = createHmac("sha256", secret);
    hmac.update(rawBody, "utf8");
    const expectedSig = hmac.digest("hex");

    try {
      return timingSafeEqual(
        Buffer.from(receivedSig, "hex"),
        Buffer.from(expectedSig, "hex"),
      );
    } catch {
      return false;
    }
  }

  getAllPreferences(): NotificationPreferences[] {
    return dbGetAllNotificationPreferences();
  }

  /**
   * Get delivery logs for a specific user
   */
  getLogs(userId: string): NotificationLog[] {
    return dbGetNotificationLogs(userId);
  }
}

export const notificationService = new NotificationService();
