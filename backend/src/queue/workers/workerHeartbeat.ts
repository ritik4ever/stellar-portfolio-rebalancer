import { getConnectionOptions } from '../connection.js';
import { logger } from '../../utils/logger.js';
import type { WorkerRuntimeStatus } from './workerRuntime.js';

/**
 * Worker heartbeat and status persistence layer
 * Stores worker status in Redis so operators can query health without reading logs
 * Issue #450: Persist worker heartbeat and status for ops visibility
 */

const WORKER_STATUS_KEY_PREFIX = 'worker:status:';
const WORKER_HEARTBEAT_TTL = 120; // 2 minutes - status expires if not updated

export interface PersistedWorkerStatus {
  name: string;
  concurrency: number;
  started: boolean;
  ready: boolean;
  lastStartedAt?: string;
  lastReadyAt?: string;
  lastStoppedAt?: string;
  lastError?: string;
  lastSuccessfulRunAt?: string;
  lastErrorAt?: string;
  schedulerRegistered: boolean;
  
  // Persistence metadata
  persistedAt: string;
  heartbeatAt: string;
  isHealthy: boolean; // true if updated within WORKER_HEARTBEAT_TTL
}

/**
 * Get Redis client
 * Uses the same connection as BullMQ
 */
async function getRedisClient() {
  const connectionOptions = getConnectionOptions();
  // Dynamic import to avoid circular deps
  // In tests, avoid connecting to a real Redis server by returning an in-memory mock.
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    // Simple in-memory Redis-like client supporting the subset used in tests
    class MockRedis {
      store: Map<string, { value: string; expiresAt?: number }> = new Map();

      _cleanExpired() {
        const now = Date.now();
        for (const [k, v] of this.store.entries()) {
          if (v.expiresAt && v.expiresAt <= now) this.store.delete(k);
        }
      }

      async setex(key: string, ttl: number, value: string) {
        const expiresAt = Date.now() + ttl * 1000;
        this.store.set(key, { value, expiresAt });
        return 'OK';
      }

      async get(key: string) {
        this._cleanExpired();
        const v = this.store.get(key);
        return v ? v.value : null;
      }

      async keys(pattern: string) {
        this._cleanExpired();
        if (pattern.endsWith('*')) {
          const prefix = pattern.slice(0, -1);
          return Array.from(this.store.keys()).filter((k) => k.startsWith(prefix));
        }
        return Array.from(this.store.keys()).filter((k) => k === pattern);
      }

      async del(...keys: string[]) {
        let removed = 0;
        for (const k of keys) {
          if (this.store.delete(k)) removed++;
        }
        return removed;
      }

      async quit() {
        return 'OK';
      }

      disconnect() {
      }
    }

    // reuse a single mock instance across calls so tests can observe stored keys
    // attach to global to persist between imports in the test process
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (!global.__mockRedisInstance) global.__mockRedisInstance = new MockRedis();
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return global.__mockRedisInstance as any;
  }

  const redis = await import('ioredis');
  return new redis.default(connectionOptions);
}

/**
 * Persist worker status to Redis
 * Called whenever worker status changes
 */
export async function persistWorkerStatus(status: WorkerRuntimeStatus): Promise<void> {
  try {
    const redis = await getRedisClient();
    const key = `${WORKER_STATUS_KEY_PREFIX}${status.name}`;
    
    const persisted: PersistedWorkerStatus = {
      ...status,
      persistedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      isHealthy: true
    };

    // Store with TTL so stale entries disappear
    await redis.setex(
      key,
      WORKER_HEARTBEAT_TTL,
      JSON.stringify(persisted)
    );

    logger.debug('[WORKER:heartbeat] Status persisted', { name: status.name });
    redis.disconnect();
  } catch (error) {
    logger.warn('[WORKER:heartbeat] Failed to persist status', {
      error: error instanceof Error ? error.message : String(error)
    });
    // Don't throw - persistence failure shouldn't crash the worker
  }
}

/**
 * Retrieve all persisted worker statuses
 * Used by ops routes to display worker health dashboard
 */
export async function getAllPersistedWorkerStatuses(): Promise<PersistedWorkerStatus[]> {
  try {
    const redis = await getRedisClient();
    const keys = await redis.keys(`${WORKER_STATUS_KEY_PREFIX}*`);
    
    const statuses: PersistedWorkerStatus[] = [];
    
    for (const key of keys) {
      const data = await redis.get(key);
      if (data) {
        const parsed = JSON.parse(data) as PersistedWorkerStatus;
        // Mark as healthy if recently updated
        const lastUpdateMs = new Date(parsed.heartbeatAt).getTime();
        const ageSeconds = (Date.now() - lastUpdateMs) / 1000;
        parsed.isHealthy = ageSeconds < WORKER_HEARTBEAT_TTL;
        statuses.push(parsed);
      }
    }

    redis.disconnect();
    return statuses;
  } catch (error) {
    logger.warn('[WORKER:heartbeat] Failed to retrieve persisted statuses', {
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
}

/**
 * Retrieve a specific worker's persisted status
 */
export async function getPersistedWorkerStatus(name: string): Promise<PersistedWorkerStatus | null> {
  try {
    const redis = await getRedisClient();
    const key = `${WORKER_STATUS_KEY_PREFIX}${name}`;
    const data = await redis.get(key);
    redis.disconnect();

    if (!data) return null;

    const parsed = JSON.parse(data) as PersistedWorkerStatus;
    const lastUpdateMs = new Date(parsed.heartbeatAt).getTime();
    const ageSeconds = (Date.now() - lastUpdateMs) / 1000;
    parsed.isHealthy = ageSeconds < WORKER_HEARTBEAT_TTL;
    return parsed;
  } catch (error) {
    logger.warn('[WORKER:heartbeat] Failed to retrieve status for worker', {
      name,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Update heartbeat for a specific worker without changing status
 * Called periodically to keep the Redis entry alive and show "alive" status
 */
export async function updateWorkerHeartbeat(name: string): Promise<void> {
  try {
    const redis = await getRedisClient();
    const key = `${WORKER_STATUS_KEY_PREFIX}${name}`;
    
    // Get current status
    const data = await redis.get(key);
    if (!data) {
      redis.disconnect();
      return;
    }

    const persisted = JSON.parse(data) as PersistedWorkerStatus;
    persisted.heartbeatAt = new Date().toISOString();
    persisted.isHealthy = true;

    // Refresh TTL
    await redis.setex(
      key,
      WORKER_HEARTBEAT_TTL,
      JSON.stringify(persisted)
    );

    redis.disconnect();
  } catch (error) {
    logger.debug('[WORKER:heartbeat] Failed to update heartbeat', {
      error: error instanceof Error ? error.message : String(error)
    });
    // Silent fail for heartbeat updates
  }
}

/**
 * Clear all worker status entries (used on shutdown)
 */
export async function clearAllWorkerStatus(): Promise<void> {
  try {
    const redis = await getRedisClient();
    const keys = await redis.keys(`${WORKER_STATUS_KEY_PREFIX}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    redis.disconnect();
    logger.info('[WORKER:heartbeat] Cleared all persisted worker statuses');
  } catch (error) {
    logger.warn('[WORKER:heartbeat] Failed to clear worker statuses', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Compute ops-friendly worker health summary
 * Returns aggregated health status for dashboard/alerts
 */
export async function getWorkerHealthSummary() {
  try {
    const statuses = await getAllPersistedWorkerStatuses();

    const summary = {
      total: statuses.length,
      healthy: statuses.filter(s => s.isHealthy && s.ready).length,
      unhealthy: statuses.filter(s => !s.isHealthy || s.lastError).length,
      idle: statuses.filter(s => s.ready && !s.lastError).length,
      lagging: statuses.filter(s => {
        if (!s.lastSuccessfulRunAt) return false;
        const lastRunMs = new Date(s.lastSuccessfulRunAt).getTime();
        return (Date.now() - lastRunMs) > 300000; // >5 minutes
      }).length,
      workers: statuses
    };

    return summary;
  } catch (error) {
    logger.error('[WORKER:heartbeat] Failed to compute health summary', {
      error: error instanceof Error ? error.message : String(error)
    });
    return { total: 0, healthy: 0, unhealthy: 0, idle: 0, lagging: 0, workers: [] };
  }
}
