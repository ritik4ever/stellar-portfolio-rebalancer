import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import IORedis from "ioredis";
import type { Request, Response, NextFunction } from "express";
import { fail } from "../utils/apiResponse.js";
import { logger } from "../utils/logger.js";
import { rateLimitMonitor } from "../services/rateLimitMonitor.js";
import { REDIS_URL, getCachedRedisAvailability } from "../queue/connection.js";

const GLOBAL_WINDOW_MS = parseInt(process.env.RATE_LIMIT_GLOBAL_WINDOW_MS || "", 10) || 15 * 60 * 1000;
const GLOBAL_MAX = parseInt(process.env.RATE_LIMIT_GLOBAL_MAX || "", 10) || 100;
const WRITE_MAX = parseInt(process.env.RATE_LIMIT_WRITE_MAX || "", 10) || 20;
const AUTH_MAX = parseInt(process.env.RATE_LIMIT_AUTH_MAX || "", 10) || 10;
const CRITICAL_MAX = parseInt(process.env.RATE_LIMIT_CRITICAL_MAX || "", 10) || 5;

const BURST_WINDOW_MS = parseInt(process.env.RATE_LIMIT_BURST_WINDOW_MS || "", 10) || 1000;
const BURST_MAX = parseInt(process.env.RATE_LIMIT_BURST_MAX || "", 10) || 5;
const WRITE_BURST_MAX = parseInt(process.env.RATE_LIMIT_WRITE_BURST_MAX || "", 10) || 3;

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
  return ["/health", "/ready", "/readiness", "/metrics"].includes(path);
}

function isTrustedHealthProbe(req: Request): boolean {
  const path = req.path || "";
  if (!isProbePath(path)) return false;

  const ip = req.ip || "";
  const loopbacks = ["::1", "127.0.0.1", "::ffff:127.0.0.1", "localhost"];
  if (loopbacks.includes(ip)) return true;

  const secret = process.env.HEALTH_PROBE_SECRET || "";
  if (secret && req.headers["x-probe-secret"] === secret) return true;

  return false;
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

// Core rate limiters (exported for backward compatibility)
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

// Composite middleware definitions
export const protectedWriteLimiter = [writeBurstLimiter, writeRateLimiter];
export const protectedCriticalLimiter = [
  burstProtectionLimiter,
  criticalRateLimiter,
];

// Central Route-Policy Config Map
export const RATE_LIMIT_ROUTE_POLICIES = {
  "POST /api/auth/challenge": "auth",
  "POST /api/auth/login": "auth",
  "POST /api/auth/refresh": "auth",

  "POST /api/v1/notifications/subscribe": "protectedWrite",
  "DELETE /api/v1/notifications/unsubscribe": "write",

  "POST /api/v1/portfolio": "protectedWrite",
  "POST /api/v1/portfolio/:id/rebalance": "protectedCritical",

  "POST /api/v1/rebalance/history/sync-onchain": "admin",
  "POST /api/v1/auto-rebalancer/start": "admin",
  "POST /api/v1/auto-rebalancer/stop": "admin",
  "POST /api/v1/auto-rebalancer/force-check": "admin",

  "POST /api/v1/debug/notifications/test": "admin",

  "POST /api/v1/consent/grant": "protectedWrite",
  "POST /api/v1/consent/revoke": "protectedCritical",
  "POST /api/v1/consent": "protectedWrite",
  "POST /api/v1/consent/audit/purge": "protectedCritical",
  "DELETE /api/v1/user/:address/data": "protectedCritical",

  "POST /api/v1/admin/assets": "admin",
  "DELETE /api/v1/admin/assets/:symbol": "admin",
  "PATCH /api/v1/admin/assets/:symbol": "admin",
} as const;

// Cache mapping of policy names to actual middleware arrays or handlers
const limiters: Record<string, import("express").RequestHandler | import("express").RequestHandler[]> = {
  global: globalRateLimiter,
  auth: authRateLimiter,
  write: writeRateLimiter,
  writeBurst: writeBurstLimiter,
  critical: criticalRateLimiter,
  burst: burstProtectionLimiter,
  admin: adminRateLimiter,
  protectedWrite: protectedWriteLimiter,
  protectedCritical: protectedCriticalLimiter,
};

// Compile route configuration keys to fast RegExp matchers that support legacy routes (without v1)
const routePatternMatchers = Object.entries(RATE_LIMIT_ROUTE_POLICIES).map(([routeKey, policyName]) => {
  const [method, pathPattern] = routeKey.split(" ");
  let normalizedPattern = pathPattern;
  if (pathPattern.startsWith("/api/v1/")) {
    normalizedPattern = "/api/(?:v1/)?" + pathPattern.slice(8);
  }
  const regexStr = "^" + normalizedPattern
    .replace(/\/:[a-zA-Z0-9_]+/g, "/[^/]+")
    .replace(/\//g, "\\/") + "\\/?$";
  return {
    method,
    regex: new RegExp(regexStr, "i"),
    policyName,
  };
});

// Dynamic per-route rate limiter middleware
export const dynamicRateLimiter = (
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
): void => {
  const path = req.path;
  const method = req.method;

  if (isProbePath(path)) {
    return next();
  }

  // Find matching policy in map
  const matcher = routePatternMatchers.find(
    (m) => m.method === method && m.regex.test(path),
  );

  const policyName = matcher ? matcher.policyName : "global";
  const limiter = limiters[policyName];

  if (!limiter) {
    return next();
  }

  if (Array.isArray(limiter)) {
    let index = 0;
    const runNext = (err?: any): void => {
      if (err) return next(err);
      if (index < limiter.length) {
        const middleware = limiter[index++];
        middleware(req, res, runNext);
      } else {
        next();
      }
    };
    runNext();
  } else {
    limiter(req, res, next);
  }
};

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
  return getCachedRedisAvailability() === true ? "redis" : "memory";
}
