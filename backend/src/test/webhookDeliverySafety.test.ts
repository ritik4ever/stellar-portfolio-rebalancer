import { describe, it, expect, vi } from "vitest";
import {
  deriveWebhookIdempotencyKey,
  isAmbiguousWebhookFailure,
  isPermanentWebhookFailure,
  toWebhookDeliveryError,
} from "../services/webhookDeliverySafety.js";

describe("webhookDeliverySafety", () => {
  const identity = {
    userId: "user-1",
    portfolioId: "portfolio-1",
    eventType: "rebalance",
    title: "Portfolio rebalanced",
    timestamp: "2024-01-01T00:00:00.000Z",
  };

  describe("deriveWebhookIdempotencyKey", () => {
    it("produces a stable key for the same identity", () => {
      const key1 = deriveWebhookIdempotencyKey(identity);
      const key2 = deriveWebhookIdempotencyKey(identity);
      expect(key1).toBe(key2);
    });

    it("produces different keys for different identities", () => {
      const key1 = deriveWebhookIdempotencyKey(identity);
      const key2 = deriveWebhookIdempotencyKey({ ...identity, userId: "user-2" });
      expect(key1).not.toBe(key2);
    });

    it("includes the prefix", () => {
      const key = deriveWebhookIdempotencyKey(identity);
      expect(key).toMatch(/^webhook:/);
    });
  });

  describe("isAmbiguousWebhookFailure", () => {
    it("returns true for ETIMEDOUT", () => {
      const error = new Error("timeout");
      (error as any).code = "ETIMEDOUT";
      expect(isAmbiguousWebhookFailure(error)).toBe(true);
    });

    it("returns true for ESOCKETTIMEDOUT", () => {
      const error = new Error("socket timeout");
      (error as any).code = "ESOCKETTIMEDOUT";
      expect(isAmbiguousWebhookFailure(error)).toBe(true);
    });

    it("returns true for ECONNRESET", () => {
      const error = new Error("connection reset");
      (error as any).code = "ECONNRESET";
      expect(isAmbiguousWebhookFailure(error)).toBe(true);
    });

    it("returns true for EPIPE", () => {
      const error = new Error("broken pipe");
      (error as any).code = "EPIPE";
      expect(isAmbiguousWebhookFailure(error)).toBe(true);
    });

    it("returns true for ECONNABORTED", () => {
      const error = new Error("aborted");
      (error as any).code = "ECONNABORTED";
      expect(isAmbiguousWebhookFailure(error)).toBe(true);
    });

    it("returns true for timeout message", () => {
      const error = new Error("Request timed out");
      expect(isAmbiguousWebhookFailure(error)).toBe(true);
    });

    it("returns false when explicit HTTP status is present", () => {
      const error = new Error("Bad Request");
      (error as any).status = 400;
      expect(isAmbiguousWebhookFailure(error)).toBe(false);
    });

    it("returns false when response.status is present", () => {
      const error = new Error("Internal Server Error");
      (error as any).response = { status: 500 };
      expect(isAmbiguousWebhookFailure(error)).toBe(false);
    });
  });

  describe("isPermanentWebhookFailure", () => {
    it("returns true for 400 Bad Request", () => {
      const error = new Error("Bad Request");
      (error as any).status = 400;
      expect(isPermanentWebhookFailure(error)).toBe(true);
    });

    it("returns true for 401 Unauthorized", () => {
      const error = new Error("Unauthorized");
      (error as any).status = 401;
      expect(isPermanentWebhookFailure(error)).toBe(true);
    });

    it("returns true for 403 Forbidden", () => {
      const error = new Error("Forbidden");
      (error as any).status = 403;
      expect(isPermanentWebhookFailure(error)).toBe(true);
    });

    it("returns true for 404 Not Found", () => {
      const error = new Error("Not Found");
      (error as any).status = 404;
      expect(isPermanentWebhookFailure(error)).toBe(true);
    });

    it("returns true for 422 Unprocessable Entity", () => {
      const error = new Error("Unprocessable Entity");
      (error as any).status = 422;
      expect(isPermanentWebhookFailure(error)).toBe(true);
    });

    it("returns true for 429 Too Many Requests", () => {
      const error = new Error("Rate Limited");
      (error as any).status = 429;
      expect(isPermanentWebhookFailure(error)).toBe(true);
    });

    it("returns true for invalid URL", () => {
      const error = new Error("Invalid URL");
      expect(isPermanentWebhookFailure(error)).toBe(true);
    });

    it("returns true for ENOTFOUND", () => {
      const error = new Error("ENOTFOUND");
      (error as any).code = "ENOTFOUND";
      expect(isPermanentWebhookFailure(error)).toBe(true);
    });

    it("returns false for 500 server error", () => {
      const error = new Error("Internal Server Error");
      (error as any).status = 500;
      expect(isPermanentWebhookFailure(error)).toBe(false);
    });

    it("returns false for timeout", () => {
      const error = new Error("timeout");
      (error as any).code = "ETIMEDOUT";
      expect(isPermanentWebhookFailure(error)).toBe(false);
    });
  });

  describe("toWebhookDeliveryError", () => {
    it("wraps ambiguous failure with idempotency key", () => {
      const error = new Error("timeout");
      (error as any).code = "ETIMEDOUT";
      const key = "webhook:abc123";
      const result = toWebhookDeliveryError(error, key);
      expect(result.kind).toBe("ambiguous");
      expect(result.reason).toBe("delivery_unknown");
      expect(result.idempotencyKey).toBe(key);
      expect(result.message).toContain(key);
    });

    it("wraps permanent failure with idempotency key", () => {
      const error = new Error("Bad Request");
      (error as any).status = 400;
      const key = "webhook:abc123";
      const result = toWebhookDeliveryError(error, key);
      expect(result.kind).toBe("permanent");
      expect(result.reason).toBe("client_error");
      expect(result.idempotencyKey).toBe(key);
    });

    it("wraps retryable failure with idempotency key", () => {
      const error = new Error("Internal Server Error");
      (error as any).status = 500;
      const key = "webhook:abc123";
      const result = toWebhookDeliveryError(error, key);
      expect(result.kind).toBe("retryable");
      expect(result.reason).toBe("server_error");
      expect(result.idempotencyKey).toBe(key);
    });

    it("passes through NotificationDeliveryError unchanged", () => {
      const original = new NotificationDeliveryError("test", {
        kind: "retryable",
        reason: "test",
        idempotencyKey: "webhook:original",
      });
      const result = toWebhookDeliveryError(original, "webhook:different");
      expect(result).toBe(original);
    });
  });
});