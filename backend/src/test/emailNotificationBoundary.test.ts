import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationService, type NotificationPayload } from "../services/notificationService.js";
import { _resetDeliveriesForTest } from "../services/notificationDelivery.js";

const mocks = vi.hoisted(() => ({ sendMail: vi.fn(), log: vi.fn() }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: mocks.sendMail }) },
}));
vi.mock("../db/notificationDb.js", () => ({
  dbGetNotificationPreferences: (userId: string) => ({
    userId, emailEnabled: true, emailAddress: "recipient@example.com",
    webhookEnabled: false, events: { rebalance: true },
  }),
  dbGetPortfolioNotificationOverride: () => undefined,
  dbLogNotificationOutcome: mocks.log,
}));
vi.mock("../services/databaseService.js", () => ({ databaseService: {} }));
vi.mock("../services/webhookDeadLetter.js", () => ({ webhookDeadLetterQueue: {} }));
vi.mock("../observability/metrics.js", () => ({
  recordNotificationDelivery: vi.fn(), recordNotificationDeliveryAttempt: vi.fn(),
}));
vi.mock("../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const payload: NotificationPayload = {
  userId: "user-2090", portfolioId: "portfolio-2090", eventType: "rebalance",
  title: "Portfolio Rebalanced", message: "Rebalance completed",
  timestamp: "2026-10-21T00:00:00.000Z",
};
const policy = { maxAttempts: 2, initialBackoffMs: 1, maxBackoffMs: 1, backoffMultiplier: 1 };
const emailLogs = () => mocks.log.mock.calls.filter((call) => call[1] === "email");

describe("email notification service boundary (#2090)", () => {
  let service: NotificationService;
  beforeEach(() => {
    vi.clearAllMocks();
    _resetDeliveriesForTest();
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_USER", "test-user");
    vi.stubEnv("SMTP_PASS", "test-only");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    mocks.sendMail.mockReset().mockResolvedValue({ messageId: "accepted" });
    service = new NotificationService({ email: policy, webhook: policy });
  });
  afterEach(() => {
    _resetDeliveriesForTest();
    vi.unstubAllEnvs();
  });

  it.each([
    [{ deliveryId: "explicit-2090" }, "explicit-2090"],
    [{ data: { deliveryId: "nested-2090" } }, "nested-2090"],
    [{ data: { jobId: "2090" } }, "rebalance-job-2090"],
    [{ data: { rebalanceId: "2090" } }, "rebalance-2090"],
  ])("coalesces concurrent events and records a later replay: %j", async (identity, deliveryId) => {
    let accept!: (value: { messageId: string }) => void;
    mocks.sendMail.mockImplementationOnce(() => new Promise((resolve) => { accept = resolve; }));
    const first = service.notify({ ...payload, ...identity });
    const replayPayload = { ...payload, ...identity, timestamp: "2026-10-22T00:00:00.000Z" };
    let secondFinished = false;
    const second = service.notify(replayPayload).then(() => { secondFinished = true; });
    await Promise.resolve();
    expect(secondFinished).toBe(false);
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    accept({ messageId: "accepted" });
    await Promise.all([first, second]);
    await service.notify(replayPayload);
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    expect(emailLogs().map((call) => call[3])).toEqual(["skipped", "sent", "skipped"]);
    for (const call of emailLogs()) expect(call[5].deliveryId).toBe(deliveryId);
  });

  it("keeps Message-ID stable when a failed event is reconstructed and redelivered", async () => {
    service = new NotificationService({ email: { ...policy, maxAttempts: 1 }, webhook: policy });
    mocks.sendMail.mockRejectedValueOnce(Object.assign(new Error("Connection refused"), { code: "ECONNREFUSED" }));
    await service.notify({ ...payload, data: { jobId: "2090" } });
    await service.notify({ ...payload, data: { jobId: "2090" }, title: "Rebalance completed", timestamp: "2026-10-22T00:00:00.000Z" });
    expect(mocks.sendMail).toHaveBeenCalledTimes(2);
    expect(mocks.sendMail.mock.calls[0][0].messageId).toBe(mocks.sendMail.mock.calls[1][0].messageId);
    expect(emailLogs().map((call) => call[3])).toEqual(["failed", "sent"]);
  });

  it("records retries once and then suppresses the second event", async () => {
    mocks.sendMail.mockRejectedValueOnce(Object.assign(new Error("Try later"), { responseCode: 451 }));
    const event = { ...payload, deliveryId: "retry-2090" };
    await service.notify(event);
    await service.notify(event);
    expect(mocks.sendMail).toHaveBeenCalledTimes(2);
    expect(emailLogs().map((call) => call[3])).toEqual(["retried", "sent", "skipped"]);
    expect(emailLogs().map((call) => call[5].attempt)).toEqual([1, 2, 1]);
  });

  it("does not resend an uncertain SMTP result on a second event", async () => {
    mocks.sendMail.mockRejectedValueOnce(Object.assign(new Error("Timeout"), { code: "ETIMEDOUT" }));
    const event = { ...payload, deliveryId: "uncertain-2090" };
    await service.notify(event);
    await service.notify({ ...event, timestamp: "2026-10-22T00:00:00.000Z" });
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    expect(emailLogs().map((call) => call[3])).toEqual(["uncertain", "skipped"]);
  });

  it("does not suppress different rebalance IDs or different users", async () => {
    await service.notify({ ...payload, deliveryId: "one" });
    await service.notify({ ...payload, deliveryId: "two" });
    await service.notify({ ...payload, userId: "another-user", deliveryId: "one" });
    expect(mocks.sendMail).toHaveBeenCalledTimes(3);
    expect(new Set(mocks.sendMail.mock.calls.map((call) => call[0].messageId)).size).toBe(3);
  });
});
