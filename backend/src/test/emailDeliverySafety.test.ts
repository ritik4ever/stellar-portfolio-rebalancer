import { describe, it, expect, afterEach } from "vitest";
import {
  deriveEmailMessageId,
  isAmbiguousSmtpFailure,
  isPermanentSmtpFailure,
  toEmailDeliveryError,
} from "../services/emailDeliverySafety.js";
import { assessDeliveryFailure } from "../services/notificationDelivery.js";

const baseIdentity = {
  userId: "user-1",
  portfolioId: "portfolio-1",
  eventType: "rebalance",
  title: "Rebalance Complete",
  timestamp: "2026-01-01T00:00:00.000Z",
};

function smtpError(
  properties: Record<string, unknown> = {},
  message = "Connection timeout",
): Error {
  return Object.assign(new Error(message), properties);
}

describe("deriveEmailMessageId", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("is deterministic for the same notification", () => {
    const first = deriveEmailMessageId(baseIdentity, "noreply@example.com");
    const second = deriveEmailMessageId({ ...baseIdentity }, "noreply@example.com");

    expect(first).toBe(second);
    expect(first).toMatch(/^<[a-f0-9]{32}@example\.com>$/);
  });

  it("differs across notifications and retries stay stable", () => {
    const original = deriveEmailMessageId(baseIdentity, "noreply@example.com");

    expect(
      deriveEmailMessageId(
        { ...baseIdentity, timestamp: "2026-01-01T00:01:00.000Z" },
        "noreply@example.com",
      ),
    ).not.toBe(original);
    expect(
      deriveEmailMessageId({ ...baseIdentity, eventType: "riskChange" }, "noreply@example.com"),
    ).not.toBe(original);
  });

  it("uses the configured sender domain and falls back safely", () => {
    expect(deriveEmailMessageId(baseIdentity, "Alerts <ops@mail.example.org>")).toContain(
      "@mail.example.org>",
    );
    expect(deriveEmailMessageId(baseIdentity, undefined)).toMatch(
      /@stellarportfolio\.com>$/,
    );
  });
});

describe("isAmbiguousSmtpFailure", () => {
  it("treats a transport timeout with no server response as ambiguous", () => {
    expect(isAmbiguousSmtpFailure(smtpError({ code: "ETIMEDOUT" }, "Timeout"))).toBe(true);
    expect(
      isAmbiguousSmtpFailure(smtpError({ code: "ECONNECTION" }, "Connection closed unexpectedly")),
    ).toBe(true);
  });

  it("treats an explicit SMTP rejection as definitive, not ambiguous", () => {
    expect(
      isAmbiguousSmtpFailure(
        smtpError({ code: "EMESSAGE", responseCode: 550 }, "Message failed: 550 rejected"),
      ),
    ).toBe(false);
    expect(
      isAmbiguousSmtpFailure(
        smtpError({ code: "EENVELOPE", responseCode: 451 }, "Try again later"),
      ),
    ).toBe(false);
  });

  it("does not treat failures before a connection is established as ambiguous", () => {
    expect(isAmbiguousSmtpFailure(smtpError({ code: "ECONNREFUSED" }, "connect ECONNREFUSED"))).toBe(
      false,
    );
    expect(isAmbiguousSmtpFailure(smtpError({ code: "ENOTFOUND" }, "getaddrinfo ENOTFOUND"))).toBe(
      false,
    );
  });
});

describe("isPermanentSmtpFailure", () => {
  it("marks 5xx responses, auth failures and invalid recipients as permanent", () => {
    expect(
      isPermanentSmtpFailure(smtpError({ code: "EMESSAGE", responseCode: 554 }, "550 rejected")),
    ).toBe(true);
    expect(isPermanentSmtpFailure(smtpError({ code: "EAUTH", responseCode: 535 }, "Invalid login"))).toBe(
      true,
    );
    expect(
      isPermanentSmtpFailure(smtpError({ code: "EENVELOPE" }, "No recipients defined")),
    ).toBe(true);
  });

  it("keeps temporary responses retryable", () => {
    expect(
      isPermanentSmtpFailure(smtpError({ code: "EENVELOPE", responseCode: 450 }, "Mailbox busy")),
    ).toBe(false);
    expect(isPermanentSmtpFailure(smtpError({ code: "ETIMEDOUT" }, "Timeout"))).toBe(false);
    expect(isPermanentSmtpFailure(new Error("SMTP connection refused"))).toBe(false);
  });
});

describe("toEmailDeliveryError", () => {
  const messageId = "<abc123@example.com>";

  it("stops retries and keeps the Message-ID for an unknown outcome", () => {
    const wrapped = toEmailDeliveryError(
      smtpError({ code: "ETIMEDOUT" }, "Timeout while waiting for response"),
      messageId,
    );

    expect(wrapped.kind).toBe("ambiguous");
    expect(wrapped.reason).toBe("delivery_unknown");
    expect(wrapped.idempotencyKey).toBe(messageId);
    expect(wrapped.message).toContain(messageId);
    expect(wrapped.message).toContain("Retry stopped");
    expect(assessDeliveryFailure(wrapped)).toEqual({
      kind: "ambiguous",
      reason: "delivery_unknown",
      idempotencyKey: messageId,
      mayHaveDelivered: true,
    });
  });

  it("classifies a hard rejection as permanent and diagnosable", () => {
    const wrapped = toEmailDeliveryError(
      smtpError({ code: "EMESSAGE", responseCode: 550 }, "550 mailbox unavailable"),
      messageId,
    );

    expect(wrapped.kind).toBe("permanent");
    expect(wrapped.reason).toBe("rejected");
    expect(wrapped.message).toContain(messageId);
    expect(wrapped.message).toContain("550 mailbox unavailable");
  });

  it("keeps ordinary connection failures retryable", () => {
    const wrapped = toEmailDeliveryError(
      smtpError({ code: "ECONNREFUSED" }, "connect ECONNREFUSED 127.0.0.1:587"),
      messageId,
    );

    expect(wrapped.kind).toBe("retryable");
    expect(wrapped.idempotencyKey).toBe(messageId);
    expect(assessDeliveryFailure(wrapped).mayHaveDelivered).toBe(false);
  });

  it("does not re-wrap an already classified error", () => {
    const first = toEmailDeliveryError(smtpError({ code: "ETIMEDOUT" }, "Timeout"), messageId);

    expect(toEmailDeliveryError(first, "<other@example.com>")).toBe(first);
  });
});
