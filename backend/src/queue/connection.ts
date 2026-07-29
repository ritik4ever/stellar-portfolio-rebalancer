import { logger } from "../utils/logger.js";
import type { StartupConfig } from "../config/startupConfig.js";
import { refreshRedisSecret } from "../config/runtimeSecrets.js";

// BullMQ bundles its own ioredis internally.
// We pass the current REDIS_URL string to BullMQ connection options directly.
// The URL is resolved lazily so credentials refreshed from Secrets Manager are
// used by newly created queues/workers instead of being cached for the process lifetime.

export function getRedisUrl(): string {
  return process.env.REDIS_URL || "redis://localhost:6379";
}

// Backward-compatible constant for older tests/imports. New code should call getRedisUrl().
export const REDIS_URL = getRedisUrl();

function redactRedisUrl(redisUrl: string): string {
  return redisUrl.replace(/:\/\/[^@]*@/, "://***@");
}

/**
 * Returns the shared BullMQ-compatible connection options.
 * Pass this to every Queue and Worker constructor.
 */
export function getConnectionOptions() {
  return {
    url: getRedisUrl(),
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
    lazyConnect: false,
  };
}

export const redisProbe = {
  /**
   * Checks whether Redis is reachable by doing a lightweight TCP connect + PING.
   * Uses the standalone ioredis only for this probe (not passed into BullMQ).
   */
  async isAvailable(): Promise<boolean> {
    await refreshRedisSecret();
    try {
      // Dynamic import so the module loads even if ioredis isn't installed
      const redisModule = await import("ioredis");
      const IORedis = (redisModule.Redis ?? redisModule.default) as any;
      const probe = new IORedis(getRedisUrl(), {
        lazyConnect: true,
        connectTimeout: 3000,
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
        retryStrategy: () => null,
      });
      probe.on("error", () => {});
      await probe.connect();
      await probe.ping();
      await probe.quit();
      return true;
    } catch {
      return false;
    }
  },
};

// For backward compatibility and easier access
export async function isRedisAvailable(): Promise<boolean> {
  return redisProbe.isAvailable();
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultStartupConfig(): Pick<StartupConfig, "queueStartupInitialDelayMs" | "queueStartupRetries" | "queueStartupMaxDelayMs"> {
  return {
    queueStartupRetries: 5,
    queueStartupInitialDelayMs: 1000,
    queueStartupMaxDelayMs: 10000,
  };
}

/**
 * Attempts to probe Redis with a bounded exponential backoff.
 */
async function probeRedisWithRetry(config: Pick<StartupConfig, "queueStartupInitialDelayMs" | "queueStartupRetries" | "queueStartupMaxDelayMs">): Promise<boolean> {
  let delay = config.queueStartupInitialDelayMs;

  for (let attempt = 1; attempt <= config.queueStartupRetries; attempt++) {
    const available = await redisProbe.isAvailable();
    if (available) {
      return true;
    }

    if (attempt === config.queueStartupRetries) {
      break;
    }

    logger.warn(
      `[QUEUE] Redis connection attempt ${attempt}/${config.queueStartupRetries} failed. Retrying in ${delay}ms...`,
    );

    await sleep(delay);
    delay = Math.min(delay * 2, config.queueStartupMaxDelayMs);
  }

  return false;
}

let _cachedRedisAvailable: boolean | null = null;
let _cachedRedisAvailableAt = 0;

function redisAvailabilityCacheTtlMs(): number {
  const raw = process.env.REDIS_AVAILABILITY_CACHE_TTL_MS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed >= 1000 ? parsed : 30000;
}

/**
 * Probes Redis with retries and caches the result for a short bounded TTL.
 * This avoids indefinite Redis credential/configuration caching and lets the
 * process recover after Secrets Manager AUTH-token rotation without a restart.
 */
export async function probeRedis(config?: StartupConfig): Promise<boolean> {
  const now = Date.now();
  if (_cachedRedisAvailable !== null && now - _cachedRedisAvailableAt < redisAvailabilityCacheTtlMs()) {
    return _cachedRedisAvailable;
  }
  const available = await probeRedisWithRetry(config ?? defaultStartupConfig());
  _cachedRedisAvailable = available;
  _cachedRedisAvailableAt = Date.now();
  return available;
}

export function getCachedRedisAvailability(): boolean | null {
  if (_cachedRedisAvailable === null) return null;
  if (Date.now() - _cachedRedisAvailableAt >= redisAvailabilityCacheTtlMs()) return null;
  return _cachedRedisAvailable;
}

export function resetRedisAvailabilityCache(): void {
  _cachedRedisAvailable = null;
  _cachedRedisAvailableAt = 0;
}

/**
 * Logs a startup banner for the queue subsystem.
 */
export function logQueueStartup(redisAvailable: boolean) {
  if (redisAvailable) {
    logger.info(
      "[QUEUE] Redis available – BullMQ workers and scheduler enabled",
      {
        redisUrl: redactRedisUrl(getRedisUrl()),
      },
    );
  } else {
    logger.warn(
      "[QUEUE] Redis unavailable – falling back to no-op (jobs will not be queued). Set REDIS_URL to enable queue-backed scheduling.",
    );
  }
}
