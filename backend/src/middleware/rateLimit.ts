import { rateLimit, type Options } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import IORedis from "ioredis";
import { fail } from "../utils/apiResponse.js";
import { logger } from "../utils/logger.js";
import { rateLimitMonitor } from "../services/rateLimitMonitor.js";
import { REDIS_URL, getCachedRedisAvailability } from "../queue/connection.js";

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

// Skip rate limiting for health checks and internal requests
function isProbePath(path: string): boolean {
  return path === "/health" || path === "/ready" || path === "/metrics";
}

function skipSuccessfulRequests(
  req: import("express").Request,
  res: import("express").Response,
): boolean {
  // Skip health checks
  if (isProbePath(req.path)) {
    return true;
  }

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
  legacyHeaders: false,
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
  legacyHeaders: false,
  store: makeStore("burst"),
  skip: (req) => isProbePath(req.path),
});

// Write operations rate limiter - stricter limits for mutating operations
export const writeRateLimiter = rateLimit({
  windowMs: GLOBAL_WINDOW_MS,
  limit: WRITE_MAX,
  keyGenerator: createKeyGenerator("write"),
  handler: createHandler(GLOBAL_WINDOW_MS, "write-operations"),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("write"),
});

// Write burst protection - prevent rapid write attempts
export const writeBurstLimiter = rateLimit({
  windowMs: BURST_WINDOW_MS,
  limit: WRITE_BURST_MAX,
  keyGenerator: createKeyGenerator("write-burst"),
  handler: createHandler(BURST_WINDOW_MS, "write-burst-protection"),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("write-burst"),
  skip: (req) => isProbePath(req.path),
});

// Authentication rate limiter - protect login/refresh endpoints
export const authRateLimiter = rateLimit({
  windowMs: GLOBAL_WINDOW_MS,
  limit: AUTH_MAX,
  keyGenerator: createKeyGenerator("auth"),
  handler: createHandler(GLOBAL_WINDOW_MS, "authentication"),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("auth"),
  skip: () => false,
});

// Critical operations rate limiter - for rebalancing and high-value operations
export const criticalRateLimiter = rateLimit({
  windowMs: GLOBAL_WINDOW_MS,
  limit: CRITICAL_MAX,
  keyGenerator: createKeyGenerator("critical"),
  handler: createHandler(GLOBAL_WINDOW_MS, "critical-operations"),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("critical"),
  skip: () => false,
});

// Admin operations rate limiter - protect admin endpoints
export const adminRateLimiter = rateLimit({
  windowMs: GLOBAL_WINDOW_MS,
  limit: AUTH_MAX,
  keyGenerator: createKeyGenerator("admin"),
  handler: createHandler(GLOBAL_WINDOW_MS, "admin-operations"),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: makeStore("admin"),
  skip: () => false,
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
