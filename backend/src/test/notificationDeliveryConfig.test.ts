import { describe, it, expect, afterEach } from "vitest";
import {
  computeBackoffDelayMs,
  parseNotificationDeliveryConfig,
} from "../config/notificationDeliveryConfig.js";

const ORIGINAL_ENV = { ...process.env };

describe("notificationDeliveryConfig", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("maps WEBHOOK_RETRY_COUNT to total max attempts (initial + retries)", () => {
    process.env.WEBHOOK_RETRY_COUNT = "2";
    process.env.WEBHOOK_RETRY_DELAY = "500";

    const { config, errors } = parseNotificationDeliveryConfig(process.env);

    expect(errors).toHaveLength(0);
    expect(config.webhook.maxAttempts).toBe(3);
    expect(config.webhook.initialBackoffMs).toBe(500);
  });

  it("computes exponential backoff capped by maxBackoffMs", () => {
    const policy = {
      maxAttempts: 4,
      initialBackoffMs: 1000,
      maxBackoffMs: 5000,
      backoffMultiplier: 2,
    };

    expect(computeBackoffDelayMs(policy, 0)).toBe(1000);
    expect(computeBackoffDelayMs(policy, 1)).toBe(2000);
    expect(computeBackoffDelayMs(policy, 2)).toBe(4000);
    expect(computeBackoffDelayMs(policy, 3)).toBe(5000);
  });

  it("returns validation errors for invalid backoff settings", () => {
    process.env.EMAIL_INITIAL_BACKOFF_MS = "60000";
    process.env.EMAIL_MAX_BACKOFF_MS = "1000";

    const { errors } = parseNotificationDeliveryConfig(process.env);

    expect(errors.some((e) => e.includes("EMAIL_INITIAL_BACKOFF_MS"))).toBe(true);
  });

  it("rejects invalid multipliers at startup parse", () => {
    process.env.WEBHOOK_BACKOFF_MULTIPLIER = "0.5";

    const { errors } = parseNotificationDeliveryConfig(process.env);

    expect(errors.some((e) => e.includes("WEBHOOK_BACKOFF_MULTIPLIER"))).toBe(true);
  });
});
