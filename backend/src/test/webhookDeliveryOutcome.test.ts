/**
 * SPR-2026-174 – actionable webhook delivery retry outcomes.
 *
 * Covers the observability contract operators rely on when webhook deliveries
 * misbehave:
 *  1. `assessWebhookDelivery` maps status/transport failures to the
 *     success / delayed / blocked vocabulary. A retryable failure with no retry
 *     left is blocked work, not delayed work.
 *  2. `redactWebhookEndpoint` keeps the provider host visible while hiding the
 *     capability token that normally lives in the webhook path.
 *  3. `sanitizeWebhookDetail` strips auth headers, query secrets and long hex
 *     signatures from diagnostic detail.
 *  4. `fireWebhook` records a source + attempt-start before the request and a
 *     terminal outcome afterwards, without leaking the endpoint secret.
 *  5. Network failures are reported without a fabricated HTTP status (the
 *     previous `statusCode ?? 429` made timeouts look like backoff requests).
 *  6. Metric labels stay bounded: outcome + reason + event type only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("axios", () => {
  const post = vi.fn();
  return { default: { post }, post };
});

vi.mock("../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../observability/metrics.js", () => ({
  recordWebhookDeliveryOutcome: vi.fn(),
  recordNotificationDelivery: vi.fn(),
  recordNotificationDeliveryAttempt: vi.fn(),
  recordNotificationDeliveryStalled: vi.fn(),
}));

import axios from "axios";
import { logger } from "../utils/logger.js";
import { recordWebhookDeliveryOutcome } from "../observability/metrics.js";
import {
  assessWebhookDelivery,
  redactWebhookEndpoint,
  reportWebhookDeliveryOutcome,
  sanitizeWebhookDetail,
} from "../services/webhookDeliveryOutcome.js";
import { fireWebhook } from "../notifications/webhook.js";

const WEBHOOK_SECRET = "whsec_super_secret_signing_key_123456";
const ENDPOINT =
  "https://hooks.example.com/services/T00000000/B00000000/capability-token-abc123?token=query-secret-value";

const makePayload = () => ({
  event_type: "REBALANCE_COMPLETED" as const,
  portfolio_id: "port-spr-2026-174",
  timestamp: 1_760_000_000_000,
});

function transportError(message: string, code?: string): Error & { code?: string } {
  const error = new Error(message) as Error & { code?: string };
  if (code) error.code = code;
  return error;
}

function axiosError(message: string, status?: number, headers: Record<string, string> = {}) {
  return Object.assign(new Error(message), {
    isAxiosError: true,
    response:
      status === undefined
        ? undefined
        : { status, headers, data: {}, statusText: String(status), config: {} },
  });
}

/** JSON of every log call, for leak assertions. */
function allLoggedText(): string {
  const calls = [
    ...vi.mocked(logger.info).mock.calls,
    ...vi.mocked(logger.warn).mock.calls,
    ...vi.mocked(logger.error).mock.calls,
  ];
  return JSON.stringify(calls);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.mocked(axios.post).mockReset();
});

// ─── 1. Classification ───────────────────────────────────────────────────────

describe("assessWebhookDelivery", () => {
  it("classifies a 2xx acknowledgement as success", () => {
    const outcome = assessWebhookDelivery({ statusCode: 202, willRetry: false });

    expect(outcome.state).toBe("success");
    expect(outcome.reason).toBe("provider_accepted");
    expect(outcome.retryable).toBe(false);
    expect(outcome.mayHaveDelivered).toBe(true);
    expect(outcome.detail).toBeUndefined();
  });

  it("classifies 429 with a scheduled retry as delayed work", () => {
    const outcome = assessWebhookDelivery({ statusCode: 429, willRetry: true });

    expect(outcome.state).toBe("delayed");
    expect(outcome.reason).toBe("rate_limited");
    expect(outcome.retryable).toBe(true);
    expect(outcome.mayHaveDelivered).toBe(false);
  });

  it("classifies 5xx with a scheduled retry as delayed and possibly delivered", () => {
    const outcome = assessWebhookDelivery({ statusCode: 503, willRetry: true });

    expect(outcome.state).toBe("delayed");
    expect(outcome.reason).toBe("server_error");
    expect(outcome.mayHaveDelivered).toBe(true);
  });

  it("blocks retryable failures once the retry budget is exhausted", () => {
    const outcome = assessWebhookDelivery({ statusCode: 503, willRetry: false });

    expect(outcome.state).toBe("blocked");
    expect(outcome.reason).toBe("server_error_retries_exhausted");
    expect(outcome.retryable).toBe(false);
  });

  it("blocks a 4xx rejection that a retry cannot fix", () => {
    const outcome = assessWebhookDelivery({ statusCode: 400, willRetry: true });

    expect(outcome.state).toBe("blocked");
    expect(outcome.reason).toBe("client_error");
    expect(outcome.retryable).toBe(false);
    expect(outcome.mayHaveDelivered).toBe(false);
  });

  it("classifies 401 as blocked auth work", () => {
    const outcome = assessWebhookDelivery({ statusCode: 401, willRetry: true });

    expect(outcome.state).toBe("blocked");
    expect(outcome.reason).toBe("auth");
  });

  it("classifies a transport timeout as delayed with an unknown side effect", () => {
    const outcome = assessWebhookDelivery({
      error: transportError("timeout of 5000ms exceeded", "ETIMEDOUT"),
      willRetry: true,
    });

    expect(outcome.state).toBe("delayed");
    expect(outcome.reason).toBe("timeout");
    expect(outcome.mayHaveDelivered).toBe(true);
  });

  it("classifies an AbortError from the request timeout as a timeout", () => {
    const abort = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    const outcome = assessWebhookDelivery({ error: abort, willRetry: true });

    expect(outcome.state).toBe("delayed");
    expect(outcome.reason).toBe("timeout");
  });

  it("classifies a refused connection as delayed work", () => {
    const outcome = assessWebhookDelivery({
      error: transportError("connect ECONNREFUSED 127.0.0.1:9000", "ECONNREFUSED"),
      willRetry: true,
    });

    expect(outcome.state).toBe("delayed");
    expect(outcome.reason).toBe("connection_refused");
  });

  it("blocks an exhausted transport failure instead of calling it delayed", () => {
    const outcome = assessWebhookDelivery({
      error: transportError("timeout of 5000ms exceeded", "ETIMEDOUT"),
      willRetry: false,
    });

    expect(outcome.state).toBe("blocked");
    expect(outcome.reason).toBe("timeout_retries_exhausted");
  });

  it("sanitizes the diagnostic detail before returning it", () => {
    const outcome = assessWebhookDelivery({
      error: transportError(
        `request to ${ENDPOINT} failed: Authorization: Bearer abc.def.ghi token=query-secret-value signature=${"a".repeat(64)}`,
      ),
      willRetry: false,
    });

    expect(outcome.detail).toBeDefined();
    expect(outcome.detail).not.toContain("capability-token-abc123");
    expect(outcome.detail).not.toContain("query-secret-value");
    expect(outcome.detail).not.toContain("abc.def.ghi");
    expect(outcome.detail).not.toContain("a".repeat(64));
  });
});

// ─── 2. Endpoint redaction ───────────────────────────────────────────────────

describe("redactWebhookEndpoint", () => {
  it("keeps the provider host and hides path/query capability tokens", () => {
    const redacted = redactWebhookEndpoint(ENDPOINT);

    expect(redacted).toMatch(/^https:\/\/hooks\.example\.com\/\[redacted:[0-9a-f]{8}\]$/);
    expect(redacted).not.toContain("capability-token-abc123");
    expect(redacted).not.toContain("query-secret-value");
  });

  it("produces a stable digest for the same destination", () => {
    expect(redactWebhookEndpoint(ENDPOINT)).toBe(redactWebhookEndpoint(ENDPOINT));
  });

  it("produces different digests for different destinations", () => {
    const other = ENDPOINT.replace("capability-token-abc123", "capability-token-zzz999");
    expect(redactWebhookEndpoint(other)).not.toBe(redactWebhookEndpoint(ENDPOINT));
  });

  it("handles missing and invalid endpoints without throwing", () => {
    expect(redactWebhookEndpoint(undefined)).toBe("[unknown-endpoint]");
    expect(redactWebhookEndpoint("not a url")).toBe("[invalid-endpoint]");
  });
});

// ─── 3. Detail sanitization ─────────────────────────────────────────────────

describe("sanitizeWebhookDetail", () => {
  it("removes bearer credentials, secret query params and long hex signatures", () => {
    const sanitized = sanitizeWebhookDetail(
      `POST ${ENDPOINT} Authorization: Bearer abc.def.ghi&secret=topsecret&sig=${"f".repeat(40)}`,
    );

    expect(sanitized).not.toContain("abc.def.ghi");
    expect(sanitized).not.toContain("topsecret");
    expect(sanitized).not.toContain("f".repeat(40));
    expect(sanitized).toContain("[redacted]");
  });

  it("bounds the detail length so a hostile provider cannot flood logs", () => {
    const sanitized = sanitizeWebhookDetail("x".repeat(1000));
    expect(sanitized.length).toBeLessThanOrEqual(201);
  });

  it("returns an empty string for missing detail", () => {
    expect(sanitizeWebhookDetail(undefined)).toBe("");
  });
});

// ─── 4. Outcome reporting ───────────────────────────────────────────────────

describe("reportWebhookDeliveryOutcome", () => {
  const base = {
    source: redactWebhookEndpoint(ENDPOINT),
    eventType: "rebalance",
    deliveryId: "delivery-174",
    userId: "user-174",
    attempt: 1,
    maxAttempts: 3,
  };

  it("logs success at info level with the redacted source", () => {
    const outcome = reportWebhookDeliveryOutcome({ ...base, statusCode: 200 });

    expect(outcome.state).toBe("success");
    expect(logger.info).toHaveBeenCalledWith(
      "Webhook delivery succeeded",
      expect.objectContaining({
        source: base.source,
        provider: "webhook",
        eventType: "rebalance",
        deliveryId: "delivery-174",
        attempt: 1,
        maxAttempts: 3,
        deliveryState: "success",
      }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs delayed work at warn level with the next attempt timestamp", () => {
    reportWebhookDeliveryOutcome({
      ...base,
      statusCode: 429,
      retryAfterMs: 30_000,
      nextAttemptAt: 1_760_000_030_000,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      "Webhook delivery delayed; retry scheduled",
      expect.objectContaining({
        deliveryState: "delayed",
        outcome: "rate_limited",
        retryAfterMs: 30_000,
        nextAttemptAt: new Date(1_760_000_030_000).toISOString(),
      }),
    );
  });

  it("logs blocked work at error level with the bounded reason", () => {
    reportWebhookDeliveryOutcome({ ...base, attempt: 3, statusCode: 500 });

    expect(logger.error).toHaveBeenCalledWith(
      "Webhook delivery blocked; operator action required",
      expect.objectContaining({
        deliveryState: "blocked",
        outcome: "server_error_retries_exhausted",
        retryable: false,
      }),
    );
  });

  it("publishes bounded metric labels and never the endpoint or error string", () => {
    reportWebhookDeliveryOutcome({
      ...base,
      statusCode: 503,
      error: transportError(`POST ${ENDPOINT} failed`, "ECONNRESET"),
    });

    expect(recordWebhookDeliveryOutcome).toHaveBeenCalledTimes(1);
    const labels = vi.mocked(recordWebhookDeliveryOutcome).mock.calls[0][0];
    expect(labels).toEqual({
      outcome: "delayed",
      reason: "server_error",
      eventType: "rebalance",
    });
  });

  it("does not leak the endpoint secret into any log line", () => {
    reportWebhookDeliveryOutcome({
      ...base,
      error: transportError(`POST ${ENDPOINT} failed with signature ${"b".repeat(64)}`),
    });

    const logged = allLoggedText();
    expect(logged).not.toContain("capability-token-abc123");
    expect(logged).not.toContain("query-secret-value");
    expect(logged).not.toContain("b".repeat(64));
  });
});

// ─── 5. fireWebhook integration ─────────────────────────────────────────────

describe("fireWebhook outcome signals", () => {
  it("records attempt start before the request and success afterwards", async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({ status: 200, data: "OK" });

    const result = await fireWebhook(ENDPOINT, WEBHOOK_SECRET, makePayload());

    expect(result.deliveryState).toBe("success");
    expect(result.reason).toBe("provider_accepted");

    const started = vi
      .mocked(logger.info)
      .mock.calls.find(([message]) => message === "Webhook delivery attempt started");
    expect(started).toBeDefined();
    const startedContext = started![1] as Record<string, unknown>;
    expect(startedContext.phase).toBe("attempt_started");
    expect(startedContext.deliveryId).toBe(result.deliveryId);
    expect(startedContext.source).toBe(redactWebhookEndpoint(ENDPOINT));

    const succeeded = vi
      .mocked(logger.info)
      .mock.calls.find(([message]) => message === "Webhook delivery succeeded");
    expect(succeeded).toBeDefined();
    expect((succeeded![1] as Record<string, unknown>).deliveryId).toBe(result.deliveryId);
  });

  it("reports a 429 as delayed work with the receiver's Retry-After", async () => {
    vi.mocked(axios.post).mockRejectedValueOnce(
      axiosError("Request failed with status code 429", 429, { "retry-after": "30" }),
    );

    const result = await fireWebhook(ENDPOINT, WEBHOOK_SECRET, makePayload());

    expect(result.outcome).toBe("retry");
    expect(result.deliveryState).toBe("delayed");
    expect(result.reason).toBe("rate_limited");
    expect(result.statusCode).toBe(429);
    expect(logger.warn).toHaveBeenCalledWith(
      "Webhook delivery delayed; retry scheduled",
      expect.objectContaining({ deliveryState: "delayed", retryAfterMs: 30_000 }),
    );
  });

  it("does not fabricate a 429 status for a network failure", async () => {
    vi.mocked(axios.post).mockRejectedValueOnce(
      transportError("connect ECONNREFUSED 127.0.0.1:9000", "ECONNREFUSED"),
    );

    const result = await fireWebhook(ENDPOINT, WEBHOOK_SECRET, makePayload());

    expect(result.outcome).toBe("retry");
    expect(result.deliveryState).toBe("delayed");
    expect(result.reason).toBe("connection_refused");
    expect(result.statusCode).toBeUndefined();
  });

  it("reports a permanent 4xx as blocked dead-letter work", async () => {
    vi.mocked(axios.post).mockRejectedValueOnce(
      axiosError("Request failed with status code 400", 400),
    );

    const result = await fireWebhook(ENDPOINT, WEBHOOK_SECRET, makePayload());

    expect(result.outcome).toBe("dead-letter");
    expect(result.deliveryState).toBe("blocked");
    expect(result.reason).toBe("client_error");
    expect(logger.error).toHaveBeenCalledWith(
      "Webhook delivery blocked; operator action required",
      expect.objectContaining({ deliveryState: "blocked" }),
    );
  });

  it("routes an auth rejection to blocked/auth", async () => {
    vi.mocked(axios.post).mockRejectedValueOnce(
      axiosError("Request failed with status code 401", 401),
    );

    const result = await fireWebhook(ENDPOINT, WEBHOOK_SECRET, makePayload());

    expect(result.outcome).toBe("dead-letter");
    expect(result.deliveryState).toBe("blocked");
    expect(result.reason).toBe("auth");
  });

  it("never logs the webhook path token or the signing secret", async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({ status: 200, data: "OK" });

    await fireWebhook(ENDPOINT, WEBHOOK_SECRET, makePayload());

    const logged = allLoggedText();
    expect(logged).not.toContain("capability-token-abc123");
    expect(logged).not.toContain("query-secret-value");
    expect(logged).not.toContain(WEBHOOK_SECRET);
  });
});
