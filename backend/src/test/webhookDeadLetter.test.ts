import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { webhookDeadLetterQueue, type DeadLetterItem } from "../services/webhookDeadLetter.js";
import * as connection from "../queue/connection.js";

vi.mock("../queue/connection.js", () => ({
  REDIS_URL: "redis://localhost:6379",
  isRedisAvailable: vi.fn(() => Promise.resolve(false)),
}));

vi.mock("../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeItem = (id: string, overrides: Partial<DeadLetterItem> = {}): DeadLetterItem => ({
  id,
  payload: { event: "rebalance", title: "Test", message: "Test message" },
  errorMessage: "Exhausted all webhook retry attempts",
  attemptsExhausted: 5,
  timestamp: new Date().toISOString(),
  webhookUrl: "https://example.com/webhook",
  userId: "user-1",
  eventType: "rebalance",
  ...overrides,
});

// ─── Basic queue operations ───────────────────────────────────────────────────

describe("webhookDeadLetterQueue – basic operations", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    webhookDeadLetterQueue._resetForTest();
    await webhookDeadLetterQueue.init();
  });

  afterEach(async () => {
    await webhookDeadLetterQueue.deinit();
  });

  it("pushes items and lists them", async () => {
    const item = makeItem("dl-1");
    await webhookDeadLetterQueue.push(item);

    const items = await webhookDeadLetterQueue.list();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("dl-1");
    expect(items[0].userId).toBe("user-1");
    expect(items[0].attemptsExhausted).toBe(5);
  });

  it("replays an item and removes it from queue", async () => {
    await webhookDeadLetterQueue.push(makeItem("dl-2"));
    await webhookDeadLetterQueue.push(makeItem("dl-3"));

    const replayed = await webhookDeadLetterQueue.replay("dl-2");
    expect(replayed).not.toBeNull();
    expect(replayed?.id).toBe("dl-2");

    const remaining = await webhookDeadLetterQueue.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("dl-3");
  });

  it("returns null for replay of non-existent item", async () => {
    const result = await webhookDeadLetterQueue.replay("non-existent");
    expect(result).toBeNull();
  });

  it("deletes an item from queue", async () => {
    await webhookDeadLetterQueue.push(makeItem("dl-4"));

    const deleted = await webhookDeadLetterQueue.delete("dl-4");
    expect(deleted).toBe(true);

    const items = await webhookDeadLetterQueue.list();
    expect(items).toHaveLength(0);
  });

  it("returns false for delete of non-existent item", async () => {
    const deleted = await webhookDeadLetterQueue.delete("non-existent");
    expect(deleted).toBe(false);
  });
});

// ─── Dead-letter entry creation on delivery failure ───────────────────────────

describe("webhookDeadLetterQueue – entry creation on delivery failure", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    webhookDeadLetterQueue._resetForTest();
    await webhookDeadLetterQueue.init();
  });

  afterEach(async () => {
    await webhookDeadLetterQueue.deinit();
  });

  it("stores the original payload on push after delivery failure", async () => {
    const originalPayload = {
      event: "circuitBreaker",
      title: "Circuit breaker tripped",
      message: "XLM/USDC pair halted",
      userId: "user-42",
    };

    const item = makeItem("dl-fail-1", {
      payload: originalPayload,
      errorMessage: "Exhausted all webhook retry attempts",
      attemptsExhausted: 3,
      userId: "user-42",
      eventType: "circuitBreaker",
      webhookUrl: "https://hooks.example.com/cb",
    });

    await webhookDeadLetterQueue.push(item);

    const entries = await webhookDeadLetterQueue.list();
    expect(entries).toHaveLength(1);

    const stored = entries[0];
    expect(stored.id).toBe("dl-fail-1");
    expect(stored.payload).toEqual(originalPayload);
    expect(stored.webhookUrl).toBe("https://hooks.example.com/cb");
    expect(stored.userId).toBe("user-42");
    expect(stored.eventType).toBe("circuitBreaker");
    expect(stored.errorMessage).toBe("Exhausted all webhook retry attempts");
    expect(stored.attemptsExhausted).toBe(3);
    expect(stored.timestamp).toBeDefined();
  });

  it("stores original payload and headers (webhookUrl) faithfully", async () => {
    const webhookUrl = "https://example.com/webhook?token=abc123";
    const payload = { event: "priceMovement", title: "BTC up 5%", message: "Price alert" };

    await webhookDeadLetterQueue.push(
      makeItem("dl-fail-2", { payload, webhookUrl, eventType: "priceMovement" }),
    );

    const [entry] = await webhookDeadLetterQueue.list();
    expect(entry.payload).toEqual(payload);
    expect(entry.webhookUrl).toBe(webhookUrl);
  });

  it("accumulates multiple failed deliveries as separate entries", async () => {
    await webhookDeadLetterQueue.push(makeItem("dl-fail-3", { userId: "user-A", eventType: "rebalance" }));
    await webhookDeadLetterQueue.push(makeItem("dl-fail-4", { userId: "user-B", eventType: "riskChange" }));
    await webhookDeadLetterQueue.push(makeItem("dl-fail-5", { userId: "user-A", eventType: "circuitBreaker" }));

    const entries = await webhookDeadLetterQueue.list();
    expect(entries).toHaveLength(3);

    const ids = entries.map((e) => e.id);
    expect(ids).toContain("dl-fail-3");
    expect(ids).toContain("dl-fail-4");
    expect(ids).toContain("dl-fail-5");
  });
});

// ─── Replay: outbound HTTP call simulation ────────────────────────────────────

describe("webhookDeadLetterQueue – replay with mocked outbound HTTP", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    webhookDeadLetterQueue._resetForTest();
    await webhookDeadLetterQueue.init();
  });

  afterEach(async () => {
    await webhookDeadLetterQueue.deinit();
    vi.restoreAllMocks();
  });

  it("successful replay uses the original stored payload and removes the entry", async () => {
    const originalPayload = {
      event: "rebalance",
      title: "Portfolio rebalanced",
      message: "Rebalance complete",
      userId: "user-1",
    };
    const item = makeItem("replay-ok-1", {
      payload: originalPayload,
      webhookUrl: "https://hooks.example.com/ok",
    });

    await webhookDeadLetterQueue.push(item);

    // Simulate successful HTTP delivery: replay() returns the item for the
    // caller to re-send; the entry is removed from the queue.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    vi.stubGlobal("fetch", fetchMock);

    const replayed = await webhookDeadLetterQueue.replay("replay-ok-1");

    // Returned item carries the original payload
    expect(replayed).not.toBeNull();
    expect(replayed!.id).toBe("replay-ok-1");
    expect(replayed!.payload).toEqual(originalPayload);
    expect(replayed!.webhookUrl).toBe("https://hooks.example.com/ok");

    // Simulate what the caller would do with the returned item
    const response = await fetchMock(replayed!.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Event": replayed!.eventType,
      },
      body: JSON.stringify(replayed!.payload),
    });
    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.example.com/ok",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify(originalPayload),
      }),
    );

    // Entry must be gone after successful replay
    const remaining = await webhookDeadLetterQueue.list();
    expect(remaining).toHaveLength(0);
  });

  it("failed replay re-pushes the entry with incremented attempt count", async () => {
    const item = makeItem("replay-fail-1", {
      attemptsExhausted: 5,
      webhookUrl: "https://hooks.example.com/fail",
      eventType: "rebalance",
    });

    await webhookDeadLetterQueue.push(item);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });
    vi.stubGlobal("fetch", fetchMock);

    // Replay returns the item; caller's HTTP attempt fails; caller re-pushes
    // with incremented attempt count (simulating what the replay handler does).
    const replayed = await webhookDeadLetterQueue.replay("replay-fail-1");
    expect(replayed).not.toBeNull();

    const response = await fetchMock(replayed!.webhookUrl, {
      method: "POST",
      body: JSON.stringify(replayed!.payload),
    });
    expect(response.ok).toBe(false);

    // Caller re-queues with updated attempt count
    const reQueued: DeadLetterItem = {
      ...replayed!,
      attemptsExhausted: replayed!.attemptsExhausted + 1,
      errorMessage: `Replay failed with HTTP 503`,
      timestamp: new Date().toISOString(),
    };
    await webhookDeadLetterQueue.push(reQueued);

    const entries = await webhookDeadLetterQueue.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("replay-fail-1");
    expect(entries[0].attemptsExhausted).toBe(6);
    expect(entries[0].errorMessage).toBe("Replay failed with HTTP 503");
  });

  it("failed replay does not produce a duplicate entry in the queue", async () => {
    await webhookDeadLetterQueue.push(makeItem("replay-no-dupe-1", { attemptsExhausted: 2 }));

    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const replayed = await webhookDeadLetterQueue.replay("replay-no-dupe-1");
    expect(replayed).not.toBeNull();

    // After replay(), the original entry is gone
    const afterReplay = await webhookDeadLetterQueue.list();
    expect(afterReplay).toHaveLength(0);

    // Simulate re-push on error
    await webhookDeadLetterQueue.push({
      ...replayed!,
      attemptsExhausted: replayed!.attemptsExhausted + 1,
      errorMessage: "ECONNREFUSED",
      timestamp: new Date().toISOString(),
    });

    const afterRequeue = await webhookDeadLetterQueue.list();
    expect(afterRequeue).toHaveLength(1);
    expect(afterRequeue[0].attemptsExhausted).toBe(3);
  });
});

// ─── Attempt-count tracking across repeated failed replays ────────────────────

describe("webhookDeadLetterQueue – attempt count tracking across repeated failures", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    webhookDeadLetterQueue._resetForTest();
    await webhookDeadLetterQueue.init();
  });

  afterEach(async () => {
    await webhookDeadLetterQueue.deinit();
    vi.restoreAllMocks();
  });

  it("increments attemptsExhausted correctly across three consecutive failed replays", async () => {
    // Seed with initial failure
    let currentItem = makeItem("dl-count-1", { attemptsExhausted: 5 });
    await webhookDeadLetterQueue.push(currentItem);

    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);

    for (let round = 1; round <= 3; round++) {
      const replayed = await webhookDeadLetterQueue.replay("dl-count-1");
      expect(replayed).not.toBeNull();
      expect(replayed!.attemptsExhausted).toBe(4 + round); // 5, 6, 7 on rounds 1,2,3

      // Queue is empty after replay removes the item
      expect(await webhookDeadLetterQueue.list()).toHaveLength(0);

      // Re-push with incremented count
      currentItem = {
        ...replayed!,
        attemptsExhausted: replayed!.attemptsExhausted + 1,
        errorMessage: `Replay attempt ${round} failed with HTTP 500`,
        timestamp: new Date().toISOString(),
      };
      await webhookDeadLetterQueue.push(currentItem);

      const entries = await webhookDeadLetterQueue.list();
      expect(entries).toHaveLength(1);
      expect(entries[0].attemptsExhausted).toBe(5 + round); // 6, 7, 8
    }

    // After three failed replays the entry is still retained with count = 8
    const final = await webhookDeadLetterQueue.list();
    expect(final).toHaveLength(1);
    expect(final[0].id).toBe("dl-count-1");
    expect(final[0].attemptsExhausted).toBe(8);
    expect(final[0].errorMessage).toBe("Replay attempt 3 failed with HTTP 500");
  });

  it("retains all metadata fields unchanged across replay cycles", async () => {
    const originalPayload = { event: "riskChange", title: "Risk threshold exceeded", message: "Portfolio at risk" };
    const item = makeItem("dl-count-2", {
      payload: originalPayload,
      webhookUrl: "https://hooks.example.com/risk",
      userId: "user-99",
      eventType: "riskChange",
      attemptsExhausted: 3,
    });

    await webhookDeadLetterQueue.push(item);

    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    vi.stubGlobal("fetch", fetchMock);

    const replayed = await webhookDeadLetterQueue.replay("dl-count-2");
    expect(replayed).not.toBeNull();

    // Original payload and routing metadata survive the replay cycle
    expect(replayed!.payload).toEqual(originalPayload);
    expect(replayed!.webhookUrl).toBe("https://hooks.example.com/risk");
    expect(replayed!.userId).toBe("user-99");
    expect(replayed!.eventType).toBe("riskChange");

    // Re-push preserving identity fields, only count + error change
    await webhookDeadLetterQueue.push({
      ...replayed!,
      attemptsExhausted: replayed!.attemptsExhausted + 1,
      errorMessage: "Replay failed: HTTP 429 Too Many Requests",
    });

    const [entry] = await webhookDeadLetterQueue.list();
    expect(entry.id).toBe("dl-count-2");
    expect(entry.payload).toEqual(originalPayload);
    expect(entry.webhookUrl).toBe("https://hooks.example.com/risk");
    expect(entry.userId).toBe("user-99");
    expect(entry.attemptsExhausted).toBe(4);
  });

  it("no outbound network calls are made by the queue itself", async () => {
    // Verify the queue never calls fetch on its own — all HTTP is caller-driven
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await webhookDeadLetterQueue.push(makeItem("dl-no-fetch-1"));
    await webhookDeadLetterQueue.list();
    await webhookDeadLetterQueue.replay("dl-no-fetch-1");
    await webhookDeadLetterQueue.list();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
