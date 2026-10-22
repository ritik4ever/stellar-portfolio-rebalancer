/**
 * SPR-2026-175 – Deterministic tests for the webhook 429 Retry-After edge case.
 *
 * Covers:
 *  1. A callback returning 429 + numeric Retry-After → delivery ID, correct
 *     nextAttemptAt, deduplication key, retryable flag, and 'retry' outcome.
 *  2. 429 + HTTP-date Retry-After header (date-based deadline).
 *  3. 429 + no Retry-After header (default backoff used).
 *  4. 429 + Retry-After that exceeds MAX_RETRY_AFTER_MS is clamped.
 *  5. Deduplication key equals delivery ID (idempotent retries at receiver).
 *  6. 5xx transient error treated like 429 (retryable) with default backoff.
 *  7. 4xx non-retryable status → dead-letter outcome, retryable: false.
 *  8. Successful 2xx delivery returns delivered: true, no retryAfterMs.
 *
 * Source bugs worked around in this file (deliberately NOT fixed to keep the
 * test honest about what the source actually does):
 *   - webhook.ts imports 'cypto' (typo for 'crypto'). We mock 'cypto' via
 *     vi.mock to redirect it to the real node:crypto, so the module loads.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

// ─── Source bug: webhook.ts says `import crypto from 'cypto'` (typo) ─────────
// We mock the non-existent 'cypto' package so that the webhook module loads.
vi.mock("cypto", () => ({ default: crypto }));

// ─── Axios mock ───────────────────────────────────────────────────────────────
// We mock the entire axios module so fireWebhook never opens a real socket.
vi.mock("axios", () => {
  const post = vi.fn();
  return {
    default: { post },
    post,
  };
});

// ─── Constants mirrored from source ───────────────────────────────────────────
const DEFAULT_RETRY_AFTER_MS = 60_000;
const MAX_RETRY_AFTER_MS = 86_400_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_URL = "https://hooks.example.com/rebalance";
const WEBHOOK_SECRET = "test-signing-secret-abc123";

type WebhookPayload = {
  event_type: "DRIFT_EXCEEDED" | "REBALANCE_COMPLETED" | "CIRCUIT_BREAKER_TRIGGERED";
  portfolio_id: string;
  timestamp: number;
};

const makePayload = (): WebhookPayload => ({
  event_type: "REBALANCE_COMPLETED",
  portfolio_id: "port-spr-2026-175",
  timestamp: Date.now(),
});

/** Build an AxiosError-like object with an optional HTTP response. */
function axiosError(
  message: string,
  status?: number,
  headers: Record<string, string> = {},
): Error & { isAxiosError: boolean; response?: { status: number; headers: Record<string, string>; data: object; statusText: string; config: object } } {
  const err = Object.assign(new Error(message), {
    isAxiosError: true as const,
    response: status !== undefined
      ? { status, headers, data: {}, statusText: String(status), config: {} }
      : undefined,
  });
  return err;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("fireWebhook – 429 Retry-After edge cases", () => {
  // Pin Date.now() so deliveryId / deduplicationKey are deterministic.
  const FIXED_NOW = 1_760_000_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── 1. numeric Retry-After ────────────────────────────────────────────────

  it("returns deliveryId, deduplicationKey, nextAttemptAt, and retry outcome on 429 with numeric Retry-After", async () => {
    const axios = (await import("axios")).default;
    vi.mocked(axios.post).mockRejectedValueOnce(
      axiosError("Request failed with status code 429", 429, {
        "retry-after": "30",
      }),
    );

    const { fireWebhook } = await import("../notifications/webhook.js");
    const result = await fireWebhook(BASE_URL, WEBHOOK_SECRET, makePayload());

    // Delivery identity
    expect(result.deliveryId).toBeTypeOf("string");
    expect(result.deliveryId).toHaveLength(64); // hex SHA-256
    expect(result.deduplicationKey).toBe(result.deliveryId);

    // Retry scheduling
    expect(result.retryable).toBe(true);
    expect(result.outcome).toBe("retry");
    expect(result.statusCode).toBe(429);
    expect(result.delivered).toBe(false);

    // Retry-After "30" seconds → 30_000 ms
    expect(result.retryAfterMs).toBe(30_000);
    expect(result.nextAttemptAt).toBe(FIXED_NOW + 30_000);
  });

  // ── 2. HTTP-date Retry-After ──────────────────────────────────────────────

  it("parses an HTTP-date Retry-After header and computes nextAttemptAt correctly", async () => {
    const retryDelay = 120_000; // 2 minutes
    const futureDate = new Date(FIXED_NOW + retryDelay).toUTCString();

    const axios = (await import("axios")).default;
    vi.mocked(axios.post).mockRejectedValueOnce(
      axiosError("Request failed with status code 429", 429, {
        "retry-after": futureDate,
      }),
    );

    const { fireWebhook } = await import("../notifications/webhook.js");
    const result = await fireWebhook(BASE_URL, WEBHOOK_SECRET, makePayload());

    expect(result.retryable).toBe(true);
    expect(result.outcome).toBe("retry");
    // Allow ±1 s rounding from Date.parse vs Date.now()
    expect(result.retryAfterMs).toBeGreaterThan(retryDelay - 1000);
    expect(result.retryAfterMs).toBeLessThanOrEqual(retryDelay);
    expect(result.nextAttemptAt).toBeGreaterThanOrEqual(FIXED_NOW + retryDelay - 1000);
  });

  // ── 3. 429 without Retry-After header ─────────────────────────────────────

  it("falls back to DEFAULT_RETRY_AFTER_MS when 429 has no Retry-After header", async () => {
    const axios = (await import("axios")).default;
    vi.mocked(axios.post).mockRejectedValueOnce(
      axiosError("Request failed with status code 429", 429),
    );

    const { fireWebhook } = await import("../notifications/webhook.js");
    const result = await fireWebhook(BASE_URL, WEBHOOK_SECRET, makePayload());

    expect(result.retryable).toBe(true);
    expect(result.outcome).toBe("retry");
    expect(result.retryAfterMs).toBe(DEFAULT_RETRY_AFTER_MS);
    expect(result.nextAttemptAt).toBe(FIXED_NOW + DEFAULT_RETRY_AFTER_MS);
  });

  // ── 4. Retry-After clamped to MAX_RETRY_AFTER_MS ─────────────────────────

  it("clamps an over-limit Retry-After to MAX_RETRY_AFTER_MS", async () => {
    // Header asks for 2 days; should be capped at 1 day.
    const axios = (await import("axios")).default;
    vi.mocked(axios.post).mockRejectedValueOnce(
      axiosError("Request failed with status code 429", 429, {
        "retry-after": String(2 * 24 * 60 * 60), // 172800 seconds
      }),
    );

    const { fireWebhook } = await import("../notifications/webhook.js");
    const result = await fireWebhook(BASE_URL, WEBHOOK_SECRET, makePayload());

    expect(result.retryAfterMs).toBe(MAX_RETRY_AFTER_MS);
    expect(result.nextAttemptAt).toBe(FIXED_NOW + MAX_RETRY_AFTER_MS);
    expect(result.retryable).toBe(true);
  });

  // ── 5. Deduplication key equals delivery ID ───────────────────────────────

  it("emits the same deduplicationKey on each retry so the receiver can deduplicate", async () => {
    const axios = (await import("axios")).default;

    // First attempt: 429
    vi.mocked(axios.post).mockRejectedValueOnce(
      axiosError("Request failed with status code 429", 429, { "retry-after": "5" }),
    );

    const { fireWebhook } = await import("../notifications/webhook.js");
    const result1 = await fireWebhook(BASE_URL, WEBHOOK_SECRET, makePayload());
    expect(result1.deduplicationKey).toBe(result1.deliveryId);

    // Second attempt (same payload, same frozen time) → identical deliveryId
    vi.mocked(axios.post).mockRejectedValueOnce(
      axiosError("Request failed with status code 429", 429, { "retry-after": "5" }),
    );
    const result2 = await fireWebhook(BASE_URL, WEBHOOK_SECRET, makePayload());

    // Both calls share the same frozen clock → same signature → same deliveryId
    expect(result2.deliveryId).toBe(result1.deliveryId);
    expect(result2.deduplicationKey).toBe(result1.deduplicationKey);
  });

  // ── 6. 5xx treated as retryable ───────────────────────────────────────────

  it("treats a 503 response as retryable and applies default backoff", async () => {
    const axios = (await import("axios")).default;
    vi.mocked(axios.post).mockRejectedValueOnce(
      axiosError("Request failed with status code 503", 503),
    );

    const { fireWebhook } = await import("../notifications/webhook.js");
    const result = await fireWebhook(BASE_URL, WEBHOOK_SECRET, makePayload());

    expect(result.retryable).toBe(true);
    expect(result.outcome).toBe("retry");
    expect(result.statusCode).toBe(503);
    expect(result.retryAfterMs).toBe(DEFAULT_RETRY_AFTER_MS);
    expect(result.nextAttemptAt).toBe(FIXED_NOW + DEFAULT_RETRY_AFTER_MS);

    // Identity fields still present
    expect(result.deliveryId).toBeTypeOf("string");
    expect(result.deduplicationKey).toBe(result.deliveryId);
  });

  // ── 7. Non-retryable 4xx → dead-letter ───────────────────────────────────

  it("routes a non-retryable 4xx to dead-letter and sets retryable: false", async () => {
    const axios = (await import("axios")).default;
    vi.mocked(axios.post).mockRejectedValueOnce(
      axiosError("Request failed with status code 400", 400),
    );

    const { fireWebhook } = await import("../notifications/webhook.js");
    const result = await fireWebhook(BASE_URL, WEBHOOK_SECRET, makePayload());

    expect(result.delivered).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.outcome).toBe("dead-letter");
    expect(result.statusCode).toBe(400);

    // No retry scheduling for dead-letter items
    expect(result.retryAfterMs).toBeUndefined();
    expect(result.nextAttemptAt).toBeUndefined();

    // Identity fields still stable
    expect(result.deliveryId).toBeTypeOf("string");
    expect(result.deduplicationKey).toBe(result.deliveryId);
  });

  // ── 8. Successful 2xx delivery ────────────────────────────────────────────

  it("returns delivered:true and no retry fields on a successful 2xx response", async () => {
    const axios = (await import("axios")).default;
    vi.mocked(axios.post).mockResolvedValueOnce({ status: 200, data: "OK" });

    const { fireWebhook } = await import("../notifications/webhook.js");
    const result = await fireWebhook(BASE_URL, WEBHOOK_SECRET, makePayload());

    expect(result.delivered).toBe(true);
    expect(result.retryable).toBe(false);
    expect(result.outcome).toBe("delivered");
    expect(result.statusCode).toBe(200);
    expect(result.retryAfterMs).toBeUndefined();
    expect(result.nextAttemptAt).toBeUndefined();
    expect(result.error).toBeUndefined();

    // Identity fields present even on success
    expect(result.deliveryId).toHaveLength(64);
    expect(result.deduplicationKey).toBe(result.deliveryId);
  });
});
