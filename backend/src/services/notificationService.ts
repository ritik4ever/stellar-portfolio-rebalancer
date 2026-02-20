import { logger } from "../utils/logger.js";
import {
  dbSaveNotificationPreferences,
  dbGetNotificationPreferences,
  dbGetAllNotificationPreferences,
  type NotificationPreferences,
} from "../db/notificationDb.js";
import nodemailer from "nodemailer";

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
  private readonly TIMEOUT_MS = 5000;
  private readonly MAX_RETRIES = 1;

  async send(
    payload: NotificationPayload,
    preferences: NotificationPreferences,
  ): Promise<void> {
    if (!preferences.webhookEnabled || !preferences.webhookUrl) {
      return;
    }

    const webhookPayload = {
      event: payload.eventType,
      title: payload.title,
      message: payload.message,
      data: payload.data,
      timestamp: payload.timestamp,
      userId: payload.userId,
    };

    await this.sendWithRetry(preferences.webhookUrl, webhookPayload, 0);
  }

  private async sendWithRetry(
    url: string,
    payload: any,
    attempt: number,
  ): Promise<void> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "StellarPortfolioRebalancer/1.0",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Webhook returned status ${response.status}`);
      }

      logger.info("Webhook notification sent successfully", {
        url,
        event: payload.event,
        userId: payload.userId,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Webhook notification failed", {
        url,
        attempt: attempt + 1,
        error: errorMessage,
      });

      // Retry once
      if (attempt < this.MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await this.sendWithRetry(url, payload, attempt + 1);
      } else {
        throw error;
      }
    }
  }
}

// ─────────────────────────────────────────────
// Email Provider (Nodemailer)
// ─────────────────────────────────────────────

class EmailProvider implements NotificationProvider {
  private transporter: any = null;

  constructor() {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    // Check for email configuration
    const emailConfig = {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587"),
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
      passLength: emailConfig.auth.pass?.length || 0,
    });

    // Only initialize if configuration exists
    if (emailConfig.host && emailConfig.auth.user && emailConfig.auth.pass) {
      try {
        this.transporter = nodemailer.createTransport(emailConfig);
        logger.info("Email provider initialized with Nodemailer", {
          host: emailConfig.host,
          port: emailConfig.port,
          user: emailConfig.auth.user,
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
      return;
    }

    // Use the user's provided email address
    const recipientEmail = preferences.emailAddress;

    if (!recipientEmail || !recipientEmail.includes("@")) {
      logger.warn("No valid email address for user", {
        userId: preferences.userId,
      });
      return;
    }

    const mailOptions = {
      from: process.env.SMTP_FROM || "noreply@stellarportfolio.com",
      to: recipientEmail,
      subject: `[Stellar Portfolio] ${payload.title}`,
      text: this.formatTextEmail(payload),
      html: this.formatHtmlEmail(payload),
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      logger.info("Email notification sent successfully", {
        to: recipientEmail,
        event: payload.eventType,
        userId: payload.userId,
        messageId: info.messageId,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Email notification failed", {
        to: recipientEmail,
        error: errorMessage,
      });
      throw error;
    }
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

  constructor() {
    // Initialize providers
    this.providers.push(new WebhookProvider());
    this.providers.push(new EmailProvider());

    logger.info("Notification service initialized", {
      providerCount: this.providers.length,
    });
  }

  /**
   * Subscribe or update notification preferences
   */
  subscribe(preferences: NotificationPreferences): void {
    // Validate webhook URL if provided
    if (preferences.webhookEnabled && preferences.webhookUrl) {
      if (!this.isValidWebhookUrl(preferences.webhookUrl)) {
        throw new Error("Invalid webhook URL format");
      }
    }

    if (preferences.emailEnabled && !preferences.emailAddress) {
      throw new Error("Email address is required when email is enabled");
    }

    // Save to database
    dbSaveNotificationPreferences(preferences);

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

    // Check if user wants this event type
    if (!preferences.events[payload.eventType]) {
      logger.info("User has disabled notifications for this event type", {
        userId: payload.userId,
        eventType: payload.eventType,
      });
      return;
    }

    // Send through all enabled providers (non-blocking)
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
        // Don't throw - we don't want one provider failure to block others
      }
    });

    // Wait for all providers to complete (but don't block the main flow)
    await Promise.allSettled(promises);
  }

  /**
   * Validate webhook URL format
   */
  private isValidWebhookUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  /**
   * Get all subscribed users
   */
  getAllPreferences(): NotificationPreferences[] {
    return dbGetAllNotificationPreferences();
  }
}

// Singleton export
export const notificationService = new NotificationService();
