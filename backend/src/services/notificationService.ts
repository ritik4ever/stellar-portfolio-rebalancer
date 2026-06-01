import { logger } from "../utils/logger.js";
import {
  dbSaveNotificationPreferences,
  dbGetNotificationPreferences,
  dbGetAllNotificationPreferences,
  dbLogNotificationOutcome,
  dbGetNotificationLogs,
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

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface NotificationPayload {
  userId: string;
  eventType: "rebalance" | "circuitBreaker" | "priceMovement" | "riskChange";
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
      dbLogNotificationOutcome(
        payload.userId,
        "webhook",
        payload.eventType,
        "skipped",
        "Webhook disabled or no URL provided",
      );
      return;
    }

    const policy = this.deliveryConfig.webhook;
    const webhookPayload = {
      event: payload.eventType,
      title: payload.title,
      message: payload.message,
      data: payload.data,
      timestamp: payload.timestamp,
      userId: payload.userId,
    };

    await deliverWithBackoff(
      {
        provider: "webhook",
        userId: payload.userId,
        eventType: payload.eventType,
        policy,
      },
      async () => {
        const controller = new AbortController();
        const timeoutMs = policy.requestTimeoutMs ?? 5000;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await fetch(preferences.webhookUrl!, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "StellarPortfolioRebalancer/1.0",
            },
            body: JSON.stringify(webhookPayload),
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new Error(`Webhook returned status ${response.status}`);
          }

          logger.info("Webhook notification sent successfully", {
            url: preferences.webhookUrl,
            event: payload.eventType,
            userId: payload.userId,
            maxAttempts: policy.maxAttempts,
          });
        } finally {
          clearTimeout(timeoutId);
        }
      },
    );
  }
}

// ─────────────────────────────────────────────
// Email Provider (Nodemailer)
// ─────────────────────────────────────────────

class EmailProvider implements NotificationProvider {
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly deliveryConfig: NotificationDeliveryConfig) {
    this.initializeTransporter();
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
      }
    } else {
      logger.warn("Email configuration incomplete", {
        hasHost: !!emailConfig.host,
        hasUser: !!emailConfig.auth.user,
        hasPass: !!emailConfig.auth.pass,
      });
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
   * Get user preferences
   */
  getPreferences(
    userId: string,
  ): NotificationPreferences | undefined {
    return dbGetNotificationPreferences(userId);
  }

  /**
   * Unsubscribe user from all notifications
   */
  unsubscribe(userId: string): void {
    const prefs = this.getPreferences(userId);
    if (prefs) {
      prefs.emailEnabled = false;
      prefs.webhookEnabled = false;
      dbSaveNotificationPreferences(prefs);
      logger.info("User unsubscribed from notifications", { userId });
    }
  }

  /**
   * Send notification to user
   */
  async notify(payload: NotificationPayload): Promise<void> {
    const preferences = this.getPreferences(payload.userId);
    if (!preferences) {
      logger.info("No notification preferences found for user", {
        userId: payload.userId,
      });
      return;
    }

    if (!preferences.events[payload.eventType]) {
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
