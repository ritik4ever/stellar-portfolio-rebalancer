import { logger } from "../utils/logger.js";
import type { StartupConfig } from "../config/startupConfig.js";
import { credentialManager } from "../config/credentialManager.js";

// BullMQ bundles its own ioredis internally.
// We pass the REDIS_URL string to BullMQ connection options directly.
// This avoids the type conflict between the standalone ioredis package
// and BullMQ's bundled ioredis.

export let REDIS_URL = credentialManager.getRedisUrl();

export function getRedisUrl(forceRefresh = false): string {
  REDIS_URL = credentialManager.getRedisUrl(forceRefresh);
  return REDIS_URL;
}

/**
 * Returns the shared BullMQ-compatible connection options.
 * Pass this to every Queue and Worker constructor.
 */
export function getConnectionOptions(forceRefresh = false) {
  return {
    url: getRedisUrl(forceRefresh),
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
    lazyConnect: false,
  };
}

export async function refreshRedisCredentials(): Promise<string> {
  logger.info("[QUEUE] Refreshing Redis credentials to tolerate rotation...");
  credentialManager.clearCache();
  const creds = await credentialManager.getRedisCredentials(true);
  REDIS_URL = creds.url;
  _cachedRedisAvailable = null; // Reset cached availability probe
  return REDIS_URL;
}

export const redisProbe = {
  /**
   * Checks whether Redis is reachable by doing a lightweight TCP connect + PING.
   * Uses the standalone ioredis only for this probe (not passed into BullMQ).
   */
  async isAvailable(forceRefresh = false): Promise<boolean> {
    try {
      // Dynamic import so the module loads even if ioredis isn't installed
      const ioredisMod = await import("ioredis");
      const IORedis = (ioredisMod as any).default || ioredisMod;
      const url = getRedisUrl(forceRefresh);
      const probe = new IORedis(url, {
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
export async function isRedisAvailable(forceRefresh = false): Promise<boolean> {
  return redisProbe.isAvailable(forceRefresh);
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
    const available = await redisProbe.isAvailable(attempt > 1);
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
