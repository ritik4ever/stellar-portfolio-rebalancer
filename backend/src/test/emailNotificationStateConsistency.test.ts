import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { deliverWithBackoff, _resetDeliveriesForTest } from "../services/notificationDelivery.js";
import {
  dbLogNotificationOutcome,
  dbGetNotificationLogs,
  dbGetLatestNotificationLog,
  closeNotificationDb,
} from "../db/notificationDb.js";
import { NotificationService } from "../services/notificationService.js";
import type { NotificationDeliveryPolicy } from "../config/notificationDeliveryConfig.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, mkdirSync } from "node:fs";

vi.mock("../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("SPR-2026-168: Preserve state consistency in Email notification delivery", () => {
  const testPolicy: NotificationDeliveryPolicy = {
    maxAttempts: 3,
    initialBackoffMs: 50,
    backoffMultiplier: 2,
    maxBackoffMs: 200,
    requestTimeoutMs: 500,
  };

  const userId = "G_TEST_USER_STATE_CONSISTENCY";
  let testDbPath: string;

  beforeEach(() => {
    _resetDeliveriesForTest();
    vi.clearAllMocks();
    const testDir = join(tmpdir(), `stellar-notif-consistency-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, "test.db");
    process.env.DB_PATH = testDbPath;
  });

  afterEach(() => {
    _resetDeliveriesForTest();
    closeNotificationDb();
    if (testDbPath) {
      try {
        rmSync(testDbPath, { force: true });
      } catch {}
    }
    delete process.env.DB_PATH;
  });

  describe("Concurrent Delivery Deduplication", () => {
    it("ensures exactly one user-visible notification during concurrent delivery attempts", async () => {
      const deliveryId = "rebalance-job-12345";
      let sendMailCallCount = 0;

      // Simulate sending email which takes 50ms
      const executeSendMail = vi.fn().mockImplementation(async () => {
        sendMailCallCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { messageId: "msg-123" };
      });

      // Trigger two concurrent deliveries for the exact same event / deliveryId
      const deliveryPromise1 = deliverWithBackoff(
        {
          provider: "email",
          userId,
          eventType: "rebalance",
          policy: testPolicy,
          deliveryId,
        },
        executeSendMail
      );

      const deliveryPromise2 = deliverWithBackoff(
        {
          provider: "email",
          userId,
          eventType: "rebalance",
          policy: testPolicy,
          deliveryId,
        },
        executeSendMail
      );

      await Promise.all([deliveryPromise1, deliveryPromise2]);

      // Exactly ONE user-visible email was sent
      expect(sendMailCallCount).toBe(1);
      expect(executeSendMail).toHaveBeenCalledTimes(1);

      // Verify traceable attempts in the database:
      // Both attempts are recorded and correlate to the deliveryId
      const logs = dbGetNotificationLogs(userId, 10, deliveryId);
      expect(logs.length).toBe(2);

      const sentLog = logs.find((l) => l.status === "sent");
      const skippedLog = logs.find((l) => l.status === "skipped");

      expect(sentLog).toBeDefined();
      expect(sentLog?.deliveryId).toBe(deliveryId);

      expect(skippedLog).toBeDefined();
      expect(skippedLog?.deliveryId).toBe(deliveryId);
      expect(skippedLog?.errorMessage).toContain("Concurrent notification deduplicated");

      // Verify that subsequent attempt with the same completed deliveryId is deduplicated
      const deliveryPromise3 = deliverWithBackoff(
        {
          provider: "email",
          userId,
          eventType: "rebalance",
          policy: testPolicy,
          deliveryId,
        },
        executeSendMail
      );

      await deliveryPromise3;
      expect(sendMailCallCount).toBe(1);

      const latestLog = dbGetLatestNotificationLog(userId, "email");
      expect(latestLog?.status).toBe("skipped");
      expect(latestLog?.errorMessage).toContain("already sent for this event");
    });
  });

  describe("Interrupted Work Handling", () => {
    it("persists failed state when work is interrupted during backoff, matching external failure", async () => {
      const deliveryId = "interrupted-delivery-999";
      const abortController = new AbortController();

      let attemptsMade = 0;
      const failingSendMail = vi.fn().mockImplementation(async () => {
        attemptsMade++;
        if (attemptsMade === 1) {
          // Trigger abort shortly after attempt 1 fails (during backoff sleep)
          setTimeout(() => {
            abortController.abort(new Error("Worker shutdown interrupted delivery"));
          }, 20);
          throw new Error("SMTP connection reset");
        }
        return { messageId: "msg-recovered" };
      });

      const deliveryPromise = deliverWithBackoff(
        {
          provider: "email",
          userId,
          eventType: "rebalance",
          policy: { ...testPolicy, initialBackoffMs: 150 },
          deliveryId,
          signal: abortController.signal,
        },
        failingSendMail
      );

      // The caller observes the rejection
      await expect(deliveryPromise).rejects.toThrow("Worker shutdown interrupted delivery");

      // Verify that persistent DB record reflects failure (not stuck in 'retried')
      const latestLog = dbGetLatestNotificationLog(userId, "email");
      expect(latestLog).toBeDefined();
      expect(latestLog?.status).toBe("failed");
      expect(latestLog?.deliveryId).toBe(deliveryId);
      expect(latestLog?.errorMessage).toContain("Interrupted: Worker shutdown interrupted delivery");

      // All logged attempts for this deliveryId
      const allLogs = dbGetNotificationLogs(userId, 10, deliveryId);
      expect(allLogs.some((l) => l.status === "retried")).toBe(true);
      expect(allLogs[0].status).toBe("failed");
    });
  });

  describe("NotificationService Delivery Status and Consistency", () => {
    it("reports delivery status agreeing with persisted notification records", async () => {
      const service = new NotificationService({
        email: testPolicy,
        webhook: testPolicy,
      });

      // Configure user preferences
      service.subscribe({
        userId,
        emailEnabled: true,
        emailAddress: "rebalance-user@example.com",
        webhookEnabled: false,
        digestMode: "immediate",
        events: {
          rebalance: true,
          circuitBreaker: true,
          priceMovement: true,
          riskChange: true,
        },
      });

      // Initially no deliveries
      const initialStatus = service.getDeliveryStatus(userId);
      expect(initialStatus.totalDeliveries).toBe(0);
      expect(initialStatus.channelStatus.email.enabled).toBe(true);
      expect(initialStatus.channelStatus.email.lastStatus).toBeUndefined();

      // Log a success outcome with deliveryId
      dbLogNotificationOutcome(userId, "email", "rebalance", "sent", undefined, {
        attempt: 1,
        maxAttempts: 3,
        deliveryId: "del-status-test-1",
      });

      const updatedStatus = service.getDeliveryStatus(userId);
      expect(updatedStatus.totalDeliveries).toBe(1);
      expect(updatedStatus.channelStatus.email.lastStatus).toBe("sent");
      expect(updatedStatus.latestDelivery?.deliveryId).toBe("del-status-test-1");

      // Verify getDeliveryLogs filters by deliveryId
      const filteredLogs = service.getDeliveryLogs(userId, 10, "del-status-test-1");
      expect(filteredLogs.length).toBe(1);
      expect(filteredLogs[0].status).toBe("sent");

      const emptyLogs = service.getDeliveryLogs(userId, 10, "nonexistent-delivery-id");
      expect(emptyLogs.length).toBe(0);
    });

    it("sends test notification and updates status consistently", async () => {
      const service = new NotificationService({
        email: testPolicy,
        webhook: testPolicy,
      });

      service.subscribe({
        userId,
        emailEnabled: false,
        webhookEnabled: false,
        digestMode: "immediate",
        events: {
          rebalance: true,
          circuitBreaker: true,
          priceMovement: true,
          riskChange: true,
        },
      });

      const res = await service.sendTestNotification(userId);
      expect(res.message).toBe("Test notification sent");
      expect(res.sentTo.email).toBeNull();
      expect(res.sentTo.webhook).toBeNull();
      expect(res.timestamp).toBeDefined();
    });
  });

  describe("Rebalance Notification Template Agreement", () => {
    it("formats completed and failed rebalance notifications consistently", async () => {
      const { buildNotificationPayload } = await import("../services/notificationTemplates.js");

      const completedPayload = buildNotificationPayload(userId, {
        eventType: "rebalance",
        data: {
          portfolioId: "p-test-1",
          trades: 4,
          gasUsed: "0.05 XLM",
          trigger: "auto",
          status: "completed",
        },
      });

      expect(completedPayload.title).toBe("Portfolio Rebalanced");
      expect(completedPayload.message).toContain("4 trades executed with 0.05 XLM gas used");

      const failedPayload = buildNotificationPayload(userId, {
        eventType: "rebalance",
        data: {
          portfolioId: "p-test-1",
          status: "failed",
          failureReason: "DEX liquidity pool exhausted",
        },
      });

      expect(failedPayload.title).toBe("Portfolio Rebalance Failed");
      expect(failedPayload.message).toContain("Rebalance failed for portfolio p-test-1: DEX liquidity pool exhausted");
    });
  });
});

