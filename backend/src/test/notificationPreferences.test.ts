import { describe, it, expect } from "vitest";
import {
  notificationPreferencesSchema,
  notificationEventsSchema,
  normalizeNotificationPreferences,
  NOTIFICATION_EVENTS,
} from "../services/notificationPreferences.js";

const validEvents = {
  rebalance: true,
  circuitBreaker: false,
  priceMovement: true,
  riskChange: false,
};

const basePayload = {
  emailEnabled: false,
  webhookEnabled: false,
  events: validEvents,
};

describe("NOTIFICATION_EVENTS", () => {
  it("contains all four event keys", () => {
    expect(NOTIFICATION_EVENTS).toEqual([
      "rebalance",
      "circuitBreaker",
      "priceMovement",
      "riskChange",
    ]);
  });
});

describe("notificationEventsSchema", () => {
  it("accepts a complete events object", () => {
    expect(notificationEventsSchema.safeParse(validEvents).success).toBe(true);
  });

  it("rejects missing event keys", () => {
    const result = notificationEventsSchema.safeParse({ rebalance: true });
    expect(result.success).toBe(false);
  });

  it("rejects non-boolean event values", () => {
    const result = notificationEventsSchema.safeParse({
      rebalance: "yes",
      circuitBreaker: false,
      priceMovement: true,
      riskChange: false,
    });
    expect(result.success).toBe(false);
  });
});

describe("notificationPreferencesSchema — email validation", () => {
  it("accepts valid email when emailEnabled is true", () => {
    const result = notificationPreferencesSchema.safeParse({
      ...basePayload,
      emailEnabled: true,
      emailAddress: "user@example.com",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email format", () => {
    const result = notificationPreferencesSchema.safeParse({
      ...basePayload,
      emailEnabled: true,
      emailAddress: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing emailAddress when emailEnabled is true", () => {
    const result = notificationPreferencesSchema.safeParse({
      ...basePayload,
      emailEnabled: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("emailAddress");
    }
  });

  it("normalizes empty string emailAddress to undefined", () => {
    const result = notificationPreferencesSchema.safeParse({
      ...basePayload,
      emailEnabled: false,
      emailAddress: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.emailAddress).toBeUndefined();
    }
  });
});

describe("notificationPreferencesSchema — webhook validation", () => {
  it("accepts valid https webhook URL when webhookEnabled is true", () => {
    const result = notificationPreferencesSchema.safeParse({
      ...basePayload,
      webhookEnabled: true,
      webhookUrl: "https://hooks.example.com/notify",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid http webhook URL", () => {
    const result = notificationPreferencesSchema.safeParse({
      ...basePayload,
      webhookEnabled: true,
      webhookUrl: "http://hooks.example.com/notify",
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-http/https protocol", () => {
    const result = notificationPreferencesSchema.safeParse({
      ...basePayload,
      webhookEnabled: true,
      webhookUrl: "ftp://hooks.example.com/notify",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a plain string that is not a URL", () => {
    const result = notificationPreferencesSchema.safeParse({
      ...basePayload,
      webhookEnabled: true,
      webhookUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing webhookUrl when webhookEnabled is true", () => {
    const result = notificationPreferencesSchema.safeParse({
      ...basePayload,
      webhookEnabled: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("webhookUrl");
    }
  });

  it("normalizes empty string webhookUrl to undefined", () => {
    const result = notificationPreferencesSchema.safeParse({
      ...basePayload,
      webhookEnabled: false,
      webhookUrl: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.webhookUrl).toBeUndefined();
    }
  });
});

describe("notificationPreferencesSchema — enabled/disabled combinations", () => {
  it("allows both email and webhook disabled with no addresses", () => {
    expect(notificationPreferencesSchema.safeParse(basePayload).success).toBe(
      true,
    );
  });

  it("allows both email and webhook enabled with valid fields", () => {
    const result = notificationPreferencesSchema.safeParse({
      ...basePayload,
      emailEnabled: true,
      emailAddress: "a@b.com",
      webhookEnabled: true,
      webhookUrl: "https://example.com/hook",
    });
    expect(result.success).toBe(true);
  });

  it("rejects emailEnabled + webhookEnabled both true without their required fields", () => {
    const result = notificationPreferencesSchema.safeParse({
      ...basePayload,
      emailEnabled: true,
      webhookEnabled: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("emailAddress");
      expect(paths).toContain("webhookUrl");
    }
  });
});

describe("normalizeNotificationPreferences", () => {
  it("trims whitespace from userId", () => {
    const result = normalizeNotificationPreferences({
      userId: "  user-123  ",
      emailEnabled: false,
      webhookEnabled: false,
      events: validEvents,
    });
    expect(result.userId).toBe("user-123");
  });

  it("strips emailAddress when emailEnabled is false", () => {
    const result = normalizeNotificationPreferences({
      userId: "u1",
      emailEnabled: false,
      emailAddress: "a@b.com",
      webhookEnabled: false,
      events: validEvents,
    });
    expect(result.emailAddress).toBeUndefined();
  });

  it("keeps emailAddress when emailEnabled is true", () => {
    const result = normalizeNotificationPreferences({
      userId: "u1",
      emailEnabled: true,
      emailAddress: "  a@b.com  ",
      webhookEnabled: false,
      events: validEvents,
    });
    expect(result.emailAddress).toBe("a@b.com");
  });

  it("strips webhookUrl when webhookEnabled is false", () => {
    const result = normalizeNotificationPreferences({
      userId: "u1",
      emailEnabled: false,
      webhookEnabled: false,
      webhookUrl: "https://example.com/hook",
      events: validEvents,
    });
    expect(result.webhookUrl).toBeUndefined();
  });

  it("keeps webhookUrl when webhookEnabled is true", () => {
    const result = normalizeNotificationPreferences({
      userId: "u1",
      emailEnabled: false,
      webhookEnabled: true,
      webhookUrl: "  https://example.com/hook  ",
      events: validEvents,
    });
    expect(result.webhookUrl).toBe("https://example.com/hook");
  });

  it("preserves all event flags exactly", () => {
    const events = {
      rebalance: true,
      circuitBreaker: false,
      priceMovement: false,
      riskChange: true,
    };
    const result = normalizeNotificationPreferences({
      userId: "u1",
      emailEnabled: false,
      webhookEnabled: false,
      events,
    });
    expect(result.events).toEqual(events);
  });
});
