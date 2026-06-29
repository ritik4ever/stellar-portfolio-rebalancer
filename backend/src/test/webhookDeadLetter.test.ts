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

const makeItem = (id: string): DeadLetterItem => ({
  id,
  payload: { event: "rebalance", title: "Test", message: "Test message" },
  errorMessage: "Test error",
  attemptsExhausted: 5,
  timestamp: new Date().toISOString(),
  webhookUrl: "https://example.com/webhook",
  userId: "user-1",
  eventType: "rebalance",
});

describe("webhookDeadLetterQueue", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await webhookDeadLetterQueue.init();
    webhookDeadLetterQueue._resetForTest();
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
