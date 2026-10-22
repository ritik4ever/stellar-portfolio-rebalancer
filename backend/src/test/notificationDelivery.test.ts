import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as notificationDb from "../db/notificationDb.js";
import {
  deliverStateForFailureKind,
  deliverWithBackoff,
  NotificationDeliveryError,
} from "../services/notificationDelivery.js";
import { webhookDeadLetterQueue } from "../services/webhookDeadLetter.js";

vi.mock("../services/webhookDeadLetter.js", () => ({
  webhookDeadLetterQueue: {
    init: vi.fn(() => Promise.resolve()),
    push: vi.fn(() => Promise.resolve()),
    list: vi.fn(() => Promise.resolve([])),
    _resetForTest: vi.fn(),
  },
}));

describe("deliverStateForFailureKind", () => {
  it("maps retryable failures to delayed work", () => {
    expect(deliveryStateForFailureKind("retryable")).toBe("delayed");
  });

  it("maps ambiguous failures to blocked work", () => {
    expect(deliveryStateForFailureKind("ambiguous")).toBe("blocked");
  });

  it("maps permanent failures to blocked work", () => {
    expect(deliveryStateForFailureKind("permanent")).toBe("blocked");
  });
});

describe("deliverWithBackoff", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    logSpy = vi
      .spyOn(notificationDb, "dbLogNotificationOutcome")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries with configured backoff before succeeding", async () => {
    const execute = vi
      .fn()
      .mockRejectedOnce(new Error("temporary failure"))
      .mockResolvedOnce(undefined);

    const promise = deliverWithBackoff(
      {
        provider: "webhook",
        userId: "user-1",
        eventType: "rebalance",
        policy: {
          maxAttempts: 2,
          initialBackoffMs: 1000,
          maxBackoffMs: 5000,
          backoffMultiplier: 2,
        },
      },
      execute,
    );

    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(execute).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith(
      "user-1",
      "webhook",
      "rebalance",
      "retried",
      "temporary failure",
      expect.objectContaining({ attempt: 1, backoffDelayMs: 1000, deliveryState: "delayed" }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      "user-1",
      "webhook",
      "rebalance",
      "sent",
      undefined,
      expect.objectContaining({ attempt: 2, deliveryState: "success" }),
    );
  });

  it("logs delayed work after exhausting max attempts on a retryable failure", async () => {
    const execute = vi.fn().mockRejected(new Error("persistent failure"));

    const promise = deliverWithBackoff(
      {
        provider: "email",
        userId: "user-2",
        eventType: "riskChange",
        policy: {
          maxAttempts: 2,
          initialBackoffMs: 500,
          maxBackoffMs: 2000,
          backoffMultiplier: 2,
        },
      },
      execute,
    );

    const expectation = expect(promise).rejects.toThrow("persistent failure");
    await vi.advanceTimersByTimeAsync(500);
    await expectation;

    expect(execute).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith(
      "user-2",
      "email",
      "riskChange",
      "failed",
      "persistent failure",
      expect.objectContaining({ attempt: 2, maxAttempts: 2, deliveryState: "delayed" }),
    );
  });

  it("stops on an ambiguous email failure instead of risking a duplicate", async () => {
    const ambiguous = new NotificationDeliveryError("Email delivery outcome unknown", {
      kind: "ambiguous",
      reason: "delivery_unknown",
      idempotencyKey: "<abc@example.com>",
    });
    const execute = vi.fn().mockRejected(ambiguous);

    const promise = deliverWithBackoff(
      {
        provider: "email",
        userId: "user-4",
        eventType: "rebalance",
        policy: {
          maxAttempts: 3,
          initialBackoffMs: 1000,
          maxBackoffMs: 5000,
          backoffMultiplier: 2,
        },
      },
      execute,
    );

    await expect(promise).rejects.toThrow("Email delivery outcome unknown");
    await vi.runAllTimersAsync();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalledWith(
      "user-4",
      "email",
      "rebalance",
      "retried",
      expect.anything(),
      expect.anything(),
    );
    expect(logSpy).toHaveBeenCalledWith(
      "user-4",
      "email",
      "rebalance",
      "uncertain",
      "Email delivery outcome unknown",
      expect.objectContaining({
        attempt: 1,
        maxAttempts: 3,
        failureKind: "ambiguous",
        retryable: false,
        stoppedEarly: true,
        idempotencyKey: "<abc@example.com>",
        deliveryState: "blocked",
      }),
    );
  });

  it("does not retry a permanent failure", async () => {
    const permanent = new NotificationDeliveryError("Email delivery rejected", {
      kind: "permanent",
      reason: "rejected",
      idempotencyKey: "<def@example.com>",
    });
    const execute = vi.fn().mockRejected(permanent);

    const promise = deliverWithBackoff(
      {
        provider: "email",
        userId: "user-5",
        eventType: "riskChange",
        policy: {
          maxAttempts: 3,
          initialBackoffMs: 1000,
          maxBackoffMs: 5000,
          backoffMultiplier: 2,
        },
      },
      execute,
    );

    await expect(promise).rejects.toThrow("Email delivery rejected");
    await vi.runAllTimersAsync();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      "user-5",
      "email",
      "riskChange",
      "failed",
      "Email delivery rejected",
      expect.objectContaining({
        failureKind: "permanent",
        stoppedEarly: true,
        idempotencyKey: "<def@example.com>",
        deliveryState: "blocked",
      }),
    );
  });

  it("retries webhook up to 5 times with exponential backoff", async () => {
    const execute = vi.fn().mockRejected(new Error("HTTP 503"));

    const promise = deliverWithBackoff(
      {
        provider: "webhook",
        userId: "user-3",
        eventType: "rebalance",
        policy: {
          maxAttempts: 5,
          initialBackoffMs: 1000,
          maxBackoffMs: 60000,
          backoffMultiplier: 2,
        },
      },
      execute,
    );

    const expectation = expect(promise).rejects.toThrow("HTTP 503");

    for (let i = 1; i <= 4; i++) {
      const delay = Math.min(1000 * Math.pow(2, i - 1), 60000);
      await vi.advanceTimersByTimeAsync(delay);
    }

    await expectation;

    expect(execute).toHaveBeenCalledTimes(5);
    expect(logSpy).toHaveBeenCalledWith(
      "user-3",
      "webhook",
      "rebalance",
      "failed",
      "HTTP 503",
      expect.objectContaining({ attempt: 5, maxAttempts: 5, deliveryState: "delayed" }),
    );
  });
});
