/**
 * SPR-2026-174 – webhook retry outcomes through the real provider path.
 *
 * `fireWebhook` is the one-shot helper; production notifications go through
 * `NotificationService` → `WebhookProvider` → `deliverWithBackoff`. These tests
 * exercise that path with a stubbed `fetch` so the operator signals are proven
 * against the code the scheduler actually runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../observability/metrics.js", () => ({
  recordWebhookDeliveryOutcome: vi.fn(),
  recordNotificationDelivery: vi.fn(),
  recordNotificationDeliveryAttempt: vi.fn(),
  recordNotificationDeliveryStalled: vi.fn(),
  dbQueryDuration: { observe: vi.fn() },
}));

vi.mock("../services/webhookDeadLetter.js", () => ({
  webhookDeadLetterQueue: { push: vi.fn().mockResolvedValue(undefined) },
}));

import { logger } from "../utils/logger.js";
import { recordWebhookDeliveryOutcome } from "../observability/metrics.js";
import { webhookDeadLetterQueue } from "../services/webhookDeadLetter.js";
import * as notificationDb from "../db/notificationDb.js";
import { NotificationService } from "../services/notificationService.js";
import { _resetDeliveriesForTest } from "../services/notificationDelivery.js";

const ENDPOINT = "https://hooks.example.com/services/T1/B2/capability-token-abc123";
const REDACTED = "https://hooks.example.com/[redacted:";

const preferences = {
  userId: "user-webhook-174",
  emailEnabled: false,
  webhookEnabled: true,
  webhookUrl: ENDPOINT,
  events: { rebalance: true, circuitBreaker: true, priceMovement: true, riskChange: true },
};

const payload = {
  userId: "user-webhook-174",
  eventType: "rebalance" as const,
  title: "Rebalance complete",
  message: "Portfolio rebalanced",
  timestamp: new Date().toISOString(),
  deliveryId: "delivery-174",
};

function outcomeCalls() {
  return vi.mocked(recordWebhookDeliveryOutcome).mock.calls.map(([input]) => input);
}

describe("WebhookProvider outcome signals", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    _resetDeliveriesForTest();
    process.env.WEBHOOK_RETRY_COUNT = "1";
    process.env.WEBHOOK_RETRY_DELAY = "10";
    process.env.WEBHOOK_BACKOFF_MULTIPLIER = "1";
    process.env.WEBHOOK_MAX_BACKOFF_MS = "50";
    process.env.WEBHOOK_TIMEOUT = "50";

    vi.spyOn(notificationDb, "dbGetNotificationPreferences").mockReturnValue(preferences);
    vi.spyOn(notificationDb, "dbSaveNotificationPreferences").mockImplementation(() => {});
    vi.spyOn(notificationDb, "dbLogNotificationOutcome").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    process.env = { ...originalEnv };
  });

  it("records a delayed outcome for a 503, then success after the retry", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const service = new NotificationService();
    const notifyPromise = service.notify(payload);
    await vi.advanceTimersByTimeAsync(50);
    await notifyPromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const outcomes = outcomeCalls();
    expect(outcomes[0]).toMatchObject({ outcome: "delayed", reason: "server_error", eventType: "rebalance" });
    expect(outcomes[1]).toMatchObject({ outcome: "success", reason: "provider_accepted" });

    // The source is redacted in both the start and terminal records.
    const started = vi
      .mocked(logger.info)
      .mock.calls.filter(([message]) => message === "Webhook delivery attempt started");
    expect(started).toHaveLength(2);
    for (const [, context] of started) {
      expect((context as Record<string, unknown>).source).toContain(REDACTED);
      expect(JSON.stringify(context)).not.toContain("capability-token-abc123");
    }
    expect(logger.warn).toHaveBeenCalledWith(
      "Webhook delivery delayed; retry scheduled",
      expect.objectContaining({ deliveryState: "delayed", attempt: 1, maxAttempts: 2 }),
    );
  });

  it("marks a permanent 4xx as blocked and still dead-letters the payload", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400 }));

    const service = new NotificationService();
    const notifyPromise = service.notify(payload);
    await vi.advanceTimersByTimeAsync(50);
    await notifyPromise;

    const outcomes = outcomeCalls();
    expect(outcomes.length).toBeGreaterThan(0);
    expect(outcomes.every((outcome) => outcome.outcome === "blocked")).toBe(true);
    expect(outcomes.every((outcome) => outcome.reason === "client_error")).toBe(true);

    expect(logger.error).toHaveBeenCalledWith(
      "Webhook delivery blocked; operator action required",
      expect.objectContaining({ deliveryState: "blocked", outcome: "client_error", statusCode: 400 }),
    );
    expect(webhookDeadLetterQueue.push).toHaveBeenCalledTimes(1);
    expect(vi.mocked(webhookDeadLetterQueue.push).mock.calls[0][0]).toMatchObject({
      eventType: "rebalance",
      userId: "user-webhook-174",
      attemptsExhausted: 2,
    });
  });

  it("reports delayed work for a transport timeout before the retry budget runs out", async () => {
    vi.useFakeTimers();
    const timeoutError = Object.assign(new Error("The operation was aborted"), {
      name: "AbortError",
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeoutError));

    const service = new NotificationService();
    const notifyPromise = service.notify(payload);
    await vi.advanceTimersByTimeAsync(100);
    await notifyPromise;

    const outcomes = outcomeCalls();
    expect(outcomes[0]).toMatchObject({ outcome: "delayed", reason: "timeout" });
    // Final attempt has no retry left, so the same failure becomes blocked work.
    expect(outcomes[outcomes.length - 1]).toMatchObject({
      outcome: "blocked",
      reason: "timeout_retries_exhausted",
    });
    expect(vi.mocked(webhookDeadLetterQueue.push)).toHaveBeenCalledTimes(1);
  });
});
