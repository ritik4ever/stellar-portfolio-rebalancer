import { logger } from "../utils/logger.js";
import type { StartupConfig } from "../config/startupConfig.js";

// BullMQ bundles its own ioredis internally.
// We pass the REDIS_URL string to BullMQ connection options directly.
// This avoids the type conflict between the standalone ioredis package
// and BullMQ's bundled ioredis.

export const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

/**
 * Returns the shared BullMQ-compatible connection options.
 * Pass this to every Queue and Worker constructor.
 */
export function getConnectionOptions() {
  return {
    url: REDIS_URL,
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
    try {
      // Dynamic import so the module loads even if ioredis isn't installed
      const { default: IORedis } = await import("ioredis");
      const probe = new IORedis(REDIS_URL, {
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

/**
 * Attempts to probe Redis with a bounded exponential backoff.
 */
async function probeRedisWithRetry(config: StartupConfig): Promise<boolean> {
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

/**
 * Probes Redis with retries and caches the result for the lifetime of the process.
 * Safe to call multiple times — subsequent calls return the cached value.
 */
export async function probeRedis(config: StartupConfig): Promise<boolean> {
  if (_cachedRedisAvailable !== null) {
    return _cachedRedisAvailable;
  }
  const available = await probeRedisWithRetry(config);
  _cachedRedisAvailable = available;
  return available;
}

export function getCachedRedisAvailability(): boolean | null {
  return _cachedRedisAvailable;
}

/**
 * Logs a startup banner for the queue subsystem.
 */
export function logQueueStartup(redisAvailable: boolean) {
  if (redisAvailable) {
    logger.info(
      "[QUEUE] Redis available – BullMQ workers and scheduler enabled",
      {
        redisUrl: REDIS_URL.replace(/:\/\/[^@]*@/, "://***@"),
      },
    );
  } else {
    logger.warn(
      "[QUEUE] Redis unavailable – falling back to no-op (jobs will not be queued). Set REDIS_URL to enable queue-backed scheduling.",
    );
  }
}
