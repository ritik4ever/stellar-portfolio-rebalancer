/**
 * SPR-2026-175 – Deterministic tests for the worker-restart-before-success edge case.
 *
 * Covers:
 *  1. Worker aborts via AbortSignal before success is recorded:
 *     - The finally block logs "Delivery aborted before completion" with
 *       deliveryState 'deliayed' (spelling preserved from source).
 *     - `inFlightDeliveries` is cleaned up so the in-progress promise is gone.
 *     - No success or failed outcome is double-logged.
 *
 *  2. After abort, a fresh call with the SAME deliveryId is NOT deduplicated
 *     against the aborted run (because the completedDeliveries map is empty;
 *     no 'sent' or 'uncertain' entry was recorded).
 *
 *  3. An in-flight delivery is awaited by concurrent callers (deduplication
 *     during flight); after completion all callers resolve exactly once.
 *
 *  4. A successful re-delivery after a worker restart is recorded as 'sent'
 *     and prevents subsequent duplicates.
 *
 *  5. No duplicate DB/side-effect calls are made across restart + success.
 *
 *  6. Abort before the first execute() call propagates immediately.
 *
 * Test doubles (must come before any imports of the code under test):
 *  - `notificationDb.js`  – mocked so no SQLite file is touched.
 *  - `observability/metrics.js` – mocked so prom-client is not required.
 *  - `utils/logger.js`    – mocked to silence noise.
 *  - `_resetDeliveriesForTest()` is called before every test for isolation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Module mocks (hoisted before imports of code under test) ─────────────────

vi.mock("../db/notificationDb.js", () => ({
  dbLogNotificationOutcome: vi.fn(),
}));

vi.mock("../observability/metrics.js", () => ({
  recordNotificationDelivery: vi.fn(),
  recordNotificationDeliveryAttempt: vi.fn(),
}));

vi.mock("../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logAudit: vi.fn(),
}));

// ─── Code under test ──────────────────────────────────────────────────────────

import * as notificationDb from "../db/notificationDb.js";
import {
  deliverWithBackoff,
  _resetDeliveriesForTest,
  type DeliveryAttemptContext,
} from "../services/notificationDelivery.js";

// ─── Constants mirrored from source ───────────────────────────────────────────

/**
 * The deliveryState written by the abort finally-block in the source.
 * The source has a deliberate(ish) typo: "deliayed" instead of "delayed".
 * This test pins that exact value so any future fix is caught intentionally.
 */
const ABORT_DELIVERY_STATE = "deliayed";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const POLICY = {
  maxAttempts: 3,
  initialBackoffMs: 500,
  maxBackoffMs: 5_000,
  backoffMultiplier: 2,
} as const;

function makeCtx(overrides: Partial<DeliveryAttemptContext> = {}): DeliveryAttemptContext {
  return {
    provider: "webhook",
    userId: "user-restart-001",
    eventType: "rebalance",
    policy: POLICY,
    deliveryId: "delivery-spr-2026-175",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("deliverWithBackoff – worker restart before recording success", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    logSpy = vi.spyOn(notificationDb, "dbLogNotificationOutcome");
    _resetDeliveriesForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    _resetDeliveriesForTest();
  });

  // ── 1. Abort logs the right finally-block outcome ────────────────────────

  it("logs abort outcome with deliveryState 'deliayed' when AbortSignal fires before success", async () => {
    const controller = new AbortController();

    // execute always throws so the retry-sleep is entered, allowing abort to fire.
    const execute = vi.fn().mockImplementation(() => {
      throw new Error("transient network error");
    });

    const promise = deliverWithBackoff(makeCtx({ signal: controller.signal }), execute);

    // Let the synchronous part run (first attempt throws, backoff sleep starts).
    await vi.advanceTimersByTimeAsync(0);

    // Abort while sleeping between retries.
    controller.abort(new Error("worker restarted"));

    await expect(promise).rejects.toThrow();

    // The finally block must log the abort outcome.
    const abortLog = logSpy.mock.calls.find(
      ([, , , outcome]) => outcome === "failed",
    );
    expect(abortLog).toBeDefined();

    const [loggedUserId, loggedProvider, loggedEventType, , loggedMsg, loggedMeta] =
      abortLog!;

    expect(loggedUserId).toBe("user-restart-001");
    expect(loggedProvider).toBe("webhook");
    expect(loggedEventType).toBe("rebalance");
    expect(loggedMsg).toBe("Delivery aborted before completion");
    expect((loggedMeta as Record<string, unknown>).deliveryState).toBe(ABORT_DELIVERY_STATE);
    expect((loggedMeta as Record<string, unknown>).deliveryId).toBe("delivery-spr-2026-175");
  });

  // ── 2. No 'sent' entry recorded → next call is not deduplicated ──────────

  it("does not deduplicate a fresh delivery after a worker restart (no sent entry)", async () => {
    const controller = new AbortController();

    const execute = vi.fn().mockImplementation(() => {
      throw new Error("transient error");
    });

    const firstPromise = deliverWithBackoff(makeCtx({ signal: controller.signal }), execute);

    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error("worker restarted"));
    await expect(firstPromise).rejects.toThrow();

    // Reset the spy call history to count fresh calls only.
    logSpy.mockClear();
    execute.mockReset();

    // Second delivery with the same deliveryId must NOT be skipped.
    execute.mockResolvedValueOnce(undefined);

    const secondPromise = deliverWithBackoff(makeCtx(), execute);
    await secondPromise;

    // execute must have been called for the second delivery.
    expect(execute).toHaveBeenCalledTimes(1);

    // A 'sent' outcome must be logged for the second delivery.
    const sentLog = logSpy.mock.calls.find(([, , , outcome]) => outcome === "sent");
    expect(sentLog).toBeDefined();
    expect((sentLog![5] as Record<string, unknown>).deliveryState).toBe("success");
  });

  // ── 3. Concurrent callers await the in-flight promise (no duplicate exec) ─

  it("deduplicates concurrent calls with the same deliveryId while the first is in flight", async () => {
    let resolveFirst!: () => void;
    const firstCallStarted = new Promise<void>((res) => { resolveFirst = res; });

    const execute = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveFirst();
        setTimeout(() => resolve(), 100);
      }),
    );

    const ctx = makeCtx();

    const p1 = deliverWithBackoff(ctx, execute);
    await firstCallStarted; // wait until the first call is actively executing

    const p2 = deliverWithBackoff(ctx, execute);

    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([p1, p2]);

    // execute must have been called exactly once (p2 awaited p1's result).
    expect(execute).toHaveBeenCalledTimes(1);

    // Only one 'sent' log — no duplicate side effects.
    const sentCalls = logSpy.mock.calls.filter(([, , , outcome]) => outcome === "sent");
    expect(sentCalls).toHaveLength(1);

    // p2 should log a 'skipped' outcome.
    const skippedCalls = logSpy.mock.calls.filter(([, , , outcome]) => outcome === "skipped");
    expect(skippedCalls).toHaveLength(1);
  });

  // ── 4. Successful re-delivery after restart is recorded as 'sent' ─────────

  it("records a successful re-delivery after restart and prevents further duplicates", async () => {
    const controller = new AbortController();

    const execute = vi.fn().mockImplementation(() => { throw new Error("transient"); });

    const abortedPromise = deliverWithBackoff(makeCtx({ signal: controller.signal }), execute);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error("restart"));
    await expect(abortedPromise).rejects.toThrow();

    execute.mockReset();
    logSpy.mockClear();

    // Second delivery succeeds.
    execute.mockResolvedValueOnce(undefined);
    await deliverWithBackoff(makeCtx(), execute);

    expect(execute).toHaveBeenCalledTimes(1);

    const sentLog = logSpy.mock.calls.find(([, , , outcome]) => outcome === "sent");
    expect(sentLog).toBeDefined();

    // Third call with same deliveryId must be skipped (already 'sent').
    execute.mockReset();
    logSpy.mockClear();

    await deliverWithBackoff(makeCtx(), execute);
    expect(execute).not.toHaveBeenCalled();

    const skipLog = logSpy.mock.calls.find(([, , , outcome]) => outcome === "skipped");
    expect(skipLog).toBeDefined();
    expect((skipLog![5] as Record<string, unknown>).deliveryState).toBe("success");
  });

  // ── 5. No duplicate DB calls across restart + success ────────────────────

  it("produces no duplicate successful-delivery DB calls when a worker restarts then succeeds", async () => {
    const controller = new AbortController();
    const execute = vi.fn().mockImplementation(() => { throw new Error("error"); });

    // First (aborted) delivery.
    const abortedPromise = deliverWithBackoff(
      makeCtx({ signal: controller.signal }),
      execute,
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error("restart"));
    await expect(abortedPromise).rejects.toThrow();

    const sentBeforeRestart = logSpy.mock.calls.filter(([, , , outcome]) => outcome === "sent").length;
    expect(sentBeforeRestart).toBe(0); // aborted run must NOT produce a 'sent' entry

    // Second (successful) delivery.
    execute.mockReset();
    execute.mockResolvedValueOnce(undefined);
    await deliverWithBackoff(makeCtx(), execute);

    const sentLogs = logSpy.mock.calls.filter(([, , , outcome]) => outcome === "sent");
    expect(sentLogs).toHaveLength(1); // exactly one 'sent' entry overall

    // Third call → skipped, not sent again.
    execute.mockReset();
    logSpy.mockClear();
    execute.mockResolvedValueOnce(undefined);
    await deliverWithBackoff(makeCtx(), execute);

    const sentAfterDedupe = logSpy.mock.calls.filter(([, , , outcome]) => outcome === "sent");
    expect(sentAfterDedupe).toHaveLength(0);
    expect(execute).not.toHaveBeenCalled();
  });

  // ── 6. Abort before the first execute() call is ever made ────────────────

  it("propagates the abort immediately when the signal is already aborted on entry", async () => {
    const controller = new AbortController();
    // Abort with a string reason to avoid vitest treating it as an unhandled
    // Error rejection while the promise is being handed off.
    controller.abort("worker-pre-aborted");

    const execute = vi.fn().mockResolvedValueOnce(undefined);

    // Attach the rejection handler synchronously before any async work.
    const promise = deliverWithBackoff(makeCtx({ signal: controller.signal }), execute);
    const rejection = expect(promise).rejects.toBeDefined();

    await vi.runAllTimersAsync();
    await rejection;

    // execute must not have been called at all.
    expect(execute).not.toHaveBeenCalled();
  });
});
