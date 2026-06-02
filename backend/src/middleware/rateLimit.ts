import { rateLimit, type Options } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import IORedis from "ioredis";
import type { Request, Response, NextFunction } from "express";
import { fail } from "../utils/apiResponse.js";
import { logger } from "../utils/logger.js";
import { rateLimitMonitor } from "../services/rateLimitMonitor.js";
import { REDIS_URL, getCachedRedisAvailability } from "../queue/connection.js";

// ── Health-probe bypass ──────────────────────────────────────────────────────
// Probe paths that must never be subject to rate-limiting.
const PROBE_PATHS = new Set(["/health", "/ready", "/readiness", "/metrics"]);

// Loopback addresses accepted as "trusted" without a secret.
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

/**
 * HEALTH_PROBE_SECRET — optional shared secret that external probes (e.g.
 * Kubernetes liveness/readiness probes running outside the node) can present
 * via the `X-Probe-Secret` request header to bypass rate limiting.
 *
 * Leave unset (or empty) to restrict the bypass to loopback-only.
 */
const PROBE_SECRET = process.env.HEALTH_PROBE_SECRET ?? "";

/**
 * Returns true when the request is a trusted internal health probe that should
 * be exempt from ALL rate limiters.
 *
 * A request qualifies when:
 *   1. The path is one of the known probe paths, AND
 *   2. EITHER the source IP is a loopback address
 *      OR a non-empty HEALTH_PROBE_SECRET is configured and the
 *      `X-Probe-Secret` header matches it exactly.
 *
 * This keeps the bypass narrow: public traffic on probe paths still goes
 * through normal rate limiting if it comes from a non-loopback IP without
 * the secret.
 */
export function isTrustedHealthProbe(req: Request): boolean {
  if (!PROBE_PATHS.has(req.path)) return false;

  const ip = req.ip ?? req.socket?.remoteAddress ?? "";
  if (LOOPBACK.has(ip)) {
    logger.debug("[RATE-LIMIT] Probe bypass: loopback source", {
      path: req.path,
      ip,
    });
    return true;
  }

  if (PROBE_SECRET.length > 0) {
    const supplied = req.headers["x-probe-secret"];
    if (typeof supplied === "string" && supplied === PROBE_SECRET) {
      logger.debug("[RATE-LIMIT] Probe bypass: valid X-Probe-Secret", {
        path: req.path,
        ip,
      });
      return true;
    }

    // Secret configured but header missing or wrong — fall through to normal
    // rate limiting so public traffic on probe paths is not accidentally exempt.
    logger.debug("[RATE-LIMIT] Probe bypass denied: secret mismatch", {
      path: req.path,
      ip,
      headerPresent: "x-probe-secret" in req.headers,
    });
  }

  return false;
}

// Rate limiting configuration from environment
const GLOBAL_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000;
const GLOBAL_MAX = Number(process.env.RATE_LIMIT_MAX) || 100;
const WRITE_MAX = Number(process.env.RATE_LIMIT_WRITE_MAX) || 10;
const AUTH_MAX = Number(process.env.RATE_LIMIT_AUTH_MAX) || 5;
const CRITICAL_MAX = Number(process.env.RATE_LIMIT_CRITICAL_MAX) || 3;

const BURST_WINDOW_MS =
  Number(process.env.RATE_LIMIT_BURST_WINDOW_MS) || 10 * 1000;
const BURST_MAX = Number(process.env.RATE_LIMIT_BURST_MAX) || 20;
const WRITE_BURST_MAX = Number(process.env.RATE_LIMIT_WRITE_BURST_MAX) || 3;

let redisClient: IORedis | undefined;

// express-rate-limit requires a *separate* RedisStore instance per limiter.
// We share one ioredis client but wrap it in a fresh RedisStore with a unique
// prefix each time — no store object is ever reused across limiters.
function makeStore(prefix: string): RedisStore | undefined {
  if (!redisClient) return undefined;
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (...args: Parameters<IORedis["call"]>) =>
      redisClient!.call(...args) as Promise<any>,
  });
}

if (process.env.NODE_ENV !== "test") {
  try {
    redisClient = new IORedis(REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 3000,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    // Absorb all connection errors so a missing Redis never crashes the process.
    // express-rate-limit will degrade gracefully to its in-memory store if any
    // Redis command fails.
    redisClient.on("error", () => {});
    logger.info("[RATE-LIMIT] Redis store configured (lazy connect)", {
      redisUrl: REDIS_URL.replace(/:\/\/[^@]*@/, "://***@"),
    });
  } catch (error) {
    logger.warn("[RATE-LIMIT] Redis store init failed — using memory store", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
} else {
  logger.info("[RATE-LIMIT] Test environment — using memory store");
}

// Enhanced rate limit handler with detailed metrics
function createHandler(windowMs: number, limitType: string) {
  const retryAfterSec = Math.ceil(windowMs / 1000);
  return (req: import("express").Request, res: import("express").Response) => {
    const ip = req.ip;
    const userAddress = req.user?.address;
    const endpoint = `${req.method} ${req.route?.path || req.path}`;

    // Record the throttling event
    rateLimitMonitor.recordThrottle(req, limitType);

    // Log rate limit violation for monitoring
    logger.warn("[RATE-LIMIT] Request throttled", {
      limitType,
      ip,
      userAddress,
      endpoint,
      userAgent: req.get("user-agent"),
      retryAfter: retryAfterSec,
    });

    res.setHeader("Retry-After", String(retryAfterSec));
    res.setHeader("X-RateLimit-Limit-Type", limitType);

    fail(
      res,
      429,
      "RATE_LIMITED",
      `Rate limit exceeded for ${limitType}. Please try again later.`,
      {
        limitType,
        retryAfter: retryAfterSec,
        endpoint,
      },
      {
        meta: {
          retryAfter: retryAfterSec,
          limitType,
          endpoint,
        },
      },
    );
  };
}

// Key generator that combines IP and wallet address for authenticated requests
function createKeyGenerator(prefix: string) {
  return (req: import("express").Request): string => {
    const ip = req.ip || "unknown";
    const userAddress = req.user?.address;

    // For authenticated requests, use both IP and wallet address
    if (userAddress) {
      return `${prefix}:${ip}:${userAddress}`;
    }

    // For unauthenticated requests, use IP only
    return `${prefix}:${ip}`;
  };
}

// ---------------------------------------------------------------------------
// Legacy isProbePath kept for any external callers, but the authoritative
// guard for rate-limit skipping is now isTrustedHealthProbe().
// ---------------------------------------------------------------------------
/** @internal Use isTrustedHealthProbe() in middleware skip functions. */
function isProbePath(path: string): boolean {
  return PROBE_PATHS.has(path);
}

function skipSuccessfulRequests(
  req: Request,
  res: Response,
): boolean {
  // Trusted health probes bypass all rate limiting.
  if (isTrustedHealthProbe(req)) return true;

  // In test environment, don't skip any requests to ensure rate limiting works
  if (process.env.NODE_ENV === "test") {
    return false;
  }

  // Skip successful responses (only count failed/suspicious requests)
  return res.statusCode < 400;
}

// Global rate limiter - applies to all requests
export const globalRateLimiter = rateLimit({
  windowMs: GLOBAL_WINDOW_MS,
  limit: GLOBAL_MAX,
  keyGenerator: createKeyGenerator("global"),
  handler: createHandler(GLOBAL_WINDOW_MS, "global"),
  standardHeaders: "draft-7",
  legacyHeaders: true,
  store: makeStore("global"),
  skip: skipSuccessfulRequests,
  message: "Too many requests from this IP, please try again later.",
});

// Burst protection - very short window to prevent rapid-fire attacks
export const burstProtectionLimiter = rateLimit({
  windowMs: BURST_WINDOW_MS,
  limit: BURST_MAX,
  keyGenerator: createKeyGenerator("burst"),
  handler: createHandler(BURST_WINDOW_MS, "burst-protection"),
  standardHeaders: "draft-7",
  legacyHeaders: true,
  store: makeStore("burst"),
  skip: (req) => isTrustedHealthProbe(req),
});

// Write operations rate limiter - stricter limits for mutating operations
export const writeRateLimiter = rateLimit({
  windowMs: GLOBAL_WINDOW_MS,
  limit: WRITE_MAX,
  keyGenerator: createKeyGenerator("write"),
  handler: createHandler(GLOBAL_WINDOW_MS, "write-operations"),
  standardHeaders: "draft-7",
  legacyHeaders: true,
  store: makeStore("write"),
  skip: (req) => isTrustedHealthProbe(req),
});

// Write burst protection - prevent rapid write attempts
export const writeBurstLimiter = rateLimit({
  windowMs: BURST_WINDOW_MS,
  limit: WRITE_BURST_MAX,
  keyGenerator: createKeyGenerator("write-burst"),
  handler: createHandler(BURST_WINDOW_MS, "write-burst-protection"),
  standardHeaders: "draft-7",
  legacyHeaders: true,
  store: makeStore("write-burst"),
  skip: (req) => isTrustedHealthProbe(req),
});

// Authentication rate limiter - protect login/refresh endpoints
export const authRateLimiter = rateLimit({
  windowMs: GLOBAL_WINDOW_MS,
  limit: AUTH_MAX,
  keyGenerator: createKeyGenerator("auth"),
  handler: createHandler(GLOBAL_WINDOW_MS, "authentication"),
  standardHeaders: "draft-7",
  legacyHeaders: true,
  store: makeStore("auth"),
  skip: (req) => isTrustedHealthProbe(req),
});

// Critical operations rate limiter - for rebalancing and high-value operations
export const criticalRateLimiter = rateLimit({
  windowMs: GLOBAL_WINDOW_MS,
  limit: CRITICAL_MAX,
  keyGenerator: createKeyGenerator("critical"),
  handler: createHandler(GLOBAL_WINDOW_MS, "critical-operations"),
  standardHeaders: "draft-7",
  legacyHeaders: true,
  store: makeStore("critical"),
  skip: (req) => isTrustedHealthProbe(req),
});

// Admin operations rate limiter - protect admin endpoints
export const adminRateLimiter = rateLimit({
  windowMs: GLOBAL_WINDOW_MS,
  limit: AUTH_MAX,
  keyGenerator: createKeyGenerator("admin"),
  handler: createHandler(GLOBAL_WINDOW_MS, "admin-operations"),
  standardHeaders: "draft-7",
  legacyHeaders: true,
  store: makeStore("admin"),
  skip: (req) => isTrustedHealthProbe(req),
});

// Composite middleware for write operations (combines write + burst protection)
export const protectedWriteLimiter = [writeBurstLimiter, writeRateLimiter];

// Composite middleware for critical operations (combines critical + burst protection)
export const protectedCriticalLimiter = [
  burstProtectionLimiter,
  criticalRateLimiter,
];

// Middleware to record successful requests for monitoring
export const requestMonitoringMiddleware = (
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
): void => {
  rateLimitMonitor.recordRequest();
  next();
};

// Graceful shutdown function
export async function closeRateLimitStore(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
      logger.info("[RATE-LIMIT] Redis connection closed");
    } catch (error) {
      logger.warn("[RATE-LIMIT] Error closing Redis connection", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function getRateLimitStoreType(): "redis" | "memory" {
  // getCachedRedisAvailability() returns the result of probeRedis() from
  // index.ts — by the time this is called at startup, the probe has run.
  return getCachedRedisAvailability() === true ? "redis" : "memory";
}
