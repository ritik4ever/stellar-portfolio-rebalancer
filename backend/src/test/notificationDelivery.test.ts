import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as notificationDb from "../db/notificationDb.js";
import { deliverWithBackoff } from "../services/notificationDelivery.js";

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
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(undefined);

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
      expect.objectContaining({ attempt: 1, backoffDelayMs: 1000 }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      "user-1",
      "webhook",
      "rebalance",
      "sent",
      undefined,
      expect.objectContaining({ attempt: 2 }),
    );
  });

  it("logs failed after exhausting max attempts", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("persistent failure"));

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
      expect.objectContaining({ attempt: 2, maxAttempts: 2 }),
    );
  });
});
