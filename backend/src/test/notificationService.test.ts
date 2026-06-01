import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { NotificationService, type NotificationPayload } from "../services/notificationService.js";
import * as notificationDb from "../db/notificationDb.js";
import nodemailer from "nodemailer";

vi.mock("nodemailer");

const mockNodemailerTransporter = {
  sendMail: vi.fn(),
};

vi.mocked(nodemailer.createTransport).mockReturnValue(mockNodemailerTransporter as any);

const basePayload: NotificationPayload = {
  userId: "test-user",
  eventType: "rebalance",
  title: "Rebalance Complete",
  message: "Your portfolio has been rebalanced successfully.",
  timestamp: new Date().toISOString(),
};

const emailPrefs = {
  userId: "test-user",
  emailEnabled: true,
  emailAddress: "test@example.com",
  webhookEnabled: false,
  events: { rebalance: true, circuitBreaker: true, priceMovement: true, riskChange: true },
};

const unsubscribedPrefs = {
  userId: "unsubscribed-user",
  emailEnabled: false,
  webhookEnabled: false,
  events: { rebalance: false, circuitBreaker: false, priceMovement: false, riskChange: false },
};

describe("NotificationService", () => {
  const originalEnv = { ...process.env };
  let savePrefsSpy: ReturnType<typeof vi.spyOn>;
  let getPrefsSpy: ReturnType<typeof vi.spyOn>;
  let logOutcomeSpy: ReturnType<typeof vi.spyOn>;
  let getLogsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.env.SMTP_HOST = "smtp.test.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_SECURE = "false";
    process.env.SMTP_USER = "test@test.com";
    process.env.SMTP_PASS = "testpass";
    process.env.SMTP_FROM = "noreply@test.com";
    process.env.DB_PATH = ":memory:";

    savePrefsSpy = vi.spyOn(notificationDb, "dbSaveNotificationPreferences").mockImplementation(() => {});
    getPrefsSpy = vi.spyOn(notificationDb, "dbGetNotificationPreferences").mockImplementation(() => undefined);
    logOutcomeSpy = vi.spyOn(notificationDb, "dbLogNotificationOutcome").mockImplementation(() => {});
    getLogsSpy = vi.spyOn(notificationDb, "dbGetNotificationLogs").mockImplementation(() => []);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  describe("EmailProvider - SMTP failure handling", () => {
    it("does not crash the service when SMTP sendMail throws", async () => {
      process.env.EMAIL_MAX_ATTEMPTS = "1";
      getPrefsSpy.mockReturnValue(emailPrefs);
      mockNodemailerTransporter.sendMail.mockRejectedValue(new Error("SMTP connection refused"));

      const service = new NotificationService();
      const payload: NotificationPayload = { ...basePayload };

      await expect(service.notify(payload)).resolves.toBeUndefined();
    });

    it("retries email delivery with backoff before logging failed", async () => {
      process.env.EMAIL_MAX_ATTEMPTS = "2";
      process.env.EMAIL_INITIAL_BACKOFF_MS = "500";

      getPrefsSpy.mockReturnValue(emailPrefs);
      mockNodemailerTransporter.sendMail
        .mockRejectedValueOnce(new Error("SMTP server not reachable"))
        .mockRejectedValueOnce(new Error("SMTP server not reachable"));

      const service = new NotificationService();
      const notifyPromise = service.notify({ ...basePayload });

      const expectation = expect(notifyPromise).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(500);
      await expectation;

      expect(mockNodemailerTransporter.sendMail).toHaveBeenCalledTimes(2);
      expect(logOutcomeSpy).toHaveBeenCalledWith(
        "test-user",
        "email",
        "rebalance",
        "retried",
        expect.stringContaining("SMTP server not reachable"),
        expect.objectContaining({ attempt: 1, backoffDelayMs: 500 }),
      );
      expect(logOutcomeSpy).toHaveBeenCalledWith(
        "test-user",
        "email",
        "rebalance",
        "failed",
        expect.stringContaining("SMTP server not reachable"),
        expect.objectContaining({ attempt: 2 }),
      );
    });

    it("logs skipped status when email is disabled", async () => {
      getPrefsSpy.mockReturnValue({ ...emailPrefs, emailEnabled: false });

      const service = new NotificationService();
      const payload: NotificationPayload = { ...basePayload };

      await service.notify(payload);

      expect(logOutcomeSpy).toHaveBeenCalledWith(
        "test-user",
        "email",
        "rebalance",
        "skipped",
        expect.stringContaining("Email disabled")
      );
    });

    it("logs skipped status when no valid email address", async () => {
      getPrefsSpy.mockReturnValue({ ...emailPrefs, emailAddress: undefined });

      const service = new NotificationService();
      const payload: NotificationPayload = { ...basePayload };

      await service.notify(payload);

      expect(logOutcomeSpy).toHaveBeenCalledWith(
        "test-user",
        "email",
        "rebalance",
        "skipped",
        expect.stringContaining("No valid email")
      );
    });

    it("logs sent status when email sends successfully", async () => {
      getPrefsSpy.mockReturnValue(emailPrefs);
      mockNodemailerTransporter.sendMail.mockResolvedValue({ messageId: "msg-123" });

      const service = new NotificationService();
      const payload: NotificationPayload = { ...basePayload };

      await service.notify(payload);

      expect(logOutcomeSpy).toHaveBeenCalledWith(
        "test-user",
        "email",
        "rebalance",
        "sent",
        undefined,
        expect.objectContaining({ attempt: 1 }),
      );
    });

    it("surfaces error correctly without crashing when transporter is null", async () => {
      getPrefsSpy.mockReturnValue({ ...emailPrefs, emailEnabled: true });
      vi.spyOn(nodemailer, "createTransport").mockReturnValue(null as any);

      const service = new NotificationService();
      const payload: NotificationPayload = { ...basePayload };

      await expect(service.notify(payload)).resolves.toBeUndefined();
    });
  });

  describe("Unsubscribe behavior", () => {
    it("does not send notifications to unsubscribed users", async () => {
      getPrefsSpy.mockReturnValue(unsubscribedPrefs);

      const service = new NotificationService();
      const payload: NotificationPayload = { ...basePayload, userId: "unsubscribed-user" };

      await service.notify(payload);

      expect(mockNodemailerTransporter.sendMail).not.toHaveBeenCalled();
    });

    it("returns early when no preferences exist for user", async () => {
      getPrefsSpy.mockReturnValue(undefined);

      const service = new NotificationService();
      const payload: NotificationPayload = { ...basePayload };

      await service.notify(payload);

      expect(mockNodemailerTransporter.sendMail).not.toHaveBeenCalled();
    });

    it("returns early when event type is disabled for user", async () => {
      getPrefsSpy.mockReturnValue({
        ...emailPrefs,
        events: { rebalance: false, circuitBreaker: true, priceMovement: true, riskChange: true },
      });

      const service = new NotificationService();
      const payload: NotificationPayload = { ...basePayload };

      await service.notify(payload);

      expect(mockNodemailerTransporter.sendMail).not.toHaveBeenCalled();
    });
  });

  describe("WebhookProvider - failure handling", () => {
    it("retries webhook delivery with exponential backoff before failing", async () => {
      process.env.WEBHOOK_RETRY_COUNT = "1";
      process.env.WEBHOOK_RETRY_DELAY = "1000";
      process.env.WEBHOOK_BACKOFF_MULTIPLIER = "2";

      getPrefsSpy.mockReturnValue({
        userId: "webhook-user",
        emailEnabled: false,
        webhookEnabled: true,
        webhookUrl: "https://hooks.example/notify",
        events: { rebalance: true, circuitBreaker: true, priceMovement: true, riskChange: true },
      });

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      vi.stubGlobal("fetch", fetchMock);

      const service = new NotificationService();
      const notifyPromise = service.notify({ ...basePayload, userId: "webhook-user" });

      await vi.advanceTimersByTimeAsync(1000);
      await notifyPromise;

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(logOutcomeSpy).toHaveBeenCalledWith(
        "webhook-user",
        "webhook",
        "rebalance",
        "retried",
        expect.stringContaining("503"),
        expect.objectContaining({ attempt: 1, backoffDelayMs: 1000 }),
      );
      expect(logOutcomeSpy).toHaveBeenCalledWith(
        "webhook-user",
        "webhook",
        "rebalance",
        "sent",
        undefined,
        expect.objectContaining({ attempt: 2 }),
      );

      vi.unstubAllGlobals();
    });

    it("logs skipped when webhook is disabled", async () => {
      getPrefsSpy.mockReturnValue({
        userId: "webhook-user",
        emailEnabled: false,
        webhookEnabled: false,
        events: { rebalance: true, circuitBreaker: true, priceMovement: true, riskChange: true },
      });

      const service = new NotificationService();
      const payload: NotificationPayload = { ...basePayload, userId: "webhook-user" };

      await service.notify(payload);

      expect(logOutcomeSpy).toHaveBeenCalledWith(
        "webhook-user",
        "webhook",
        "rebalance",
        "skipped",
        expect.stringContaining("Webhook disabled")
      );
    });
  });

  describe("getLogs", () => {
    it("retrieves notification logs for a user", () => {
      const mockLogs = [
        { id: 1, userId: "test-user", provider: "email" as const, eventType: "rebalance", status: "sent" as const, createdAt: new Date().toISOString() },
        { id: 2, userId: "test-user", provider: "email" as const, eventType: "rebalance", status: "failed" as const, errorMessage: "SMTP error", createdAt: new Date().toISOString() },
      ];
      getLogsSpy.mockReturnValue(mockLogs);

      const service = new NotificationService();
      const logs = service.getLogs("test-user");

      expect(logs).toHaveLength(2);
      expect(getLogsSpy).toHaveBeenCalledWith("test-user");
    });
  });

  describe("subscribe and unsubscribe", () => {
    it("saves preferences when subscribing", () => {
      const service = new NotificationService();
      service.subscribe(emailPrefs);

      expect(savePrefsSpy).toHaveBeenCalledWith(emailPrefs);
    });

    it("disables all notifications when unsubscribing", () => {
      getPrefsSpy.mockReturnValue(emailPrefs);

      const service = new NotificationService();
      service.unsubscribe("test-user");

      expect(savePrefsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "test-user",
          emailEnabled: false,
          webhookEnabled: false,
        })
      );
    });
  });
});
