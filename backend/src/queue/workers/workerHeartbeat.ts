import { getConnectionOptions } from '../connection.js';
import { logger } from '../../utils/logger.js';
import type { WorkerRuntimeStatus } from './workerRuntime.js';

/**
 * Worker heartbeat and status persistence layer
 * Stores worker status in Redis so operators can query health without reading logs
 * Issue #450: Persist worker heartbeat and status for ops visibility
 * Issue #1400: Add crash auto-restart supervisor for worker heartbeat failures
 */

const WORKER_STATUS_KEY_PREFIX = 'worker:status:';
export const WORKER_HEARTBEAT_TTL = 120; // 2 minutes - status expires if not updated

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

export type WorkerRestartHandler = () => Promise<void> | void;

export interface SupervisorConfig {
  /** Number of consecutive missed heartbeats before triggering a restart (default: 3) */
  missedHeartbeatThreshold: number;
  /** Max restart attempts allowed within the restartWindowMs before entering crash loop state (default: 3) */
  maxRestartAttempts: number;
  /** Time window in milliseconds for tracking restart attempts (default: 300,000 ms / 5 min) */
  restartWindowMs: number;
  /** Max heartbeat age in milliseconds before considering a heartbeat missed (default: WORKER_HEARTBEAT_TTL * 1000) */
  heartbeatTimeoutMs: number;
}

export interface WorkerSupervisorState {
  name: string;
  consecutiveMissedHeartbeats: number;
  restartTimestamps: number[];
  inCrashLoop: boolean;
  lastRestartAt?: string;
  lastCrashLoopAt?: string;
}

export type SupervisorAction =
  | 'healthy'
  | 'heartbeat_missed'
  | 'restart_triggered'
  | 'restart_failed'
  | 'crash_loop_prevented'
  | 'no_handler';

export interface SupervisorCheckResult {
  workerName: string;
  action: SupervisorAction;
  consecutiveMissedHeartbeats: number;
  restartCountInWindow: number;
  inCrashLoop: boolean;
  error?: string;
}

export const DEFAULT_SUPERVISOR_CONFIG: SupervisorConfig = {
  missedHeartbeatThreshold: 3,
  maxRestartAttempts: 3,
  restartWindowMs: 5 * 60 * 1000, // 5 minutes
  heartbeatTimeoutMs: WORKER_HEARTBEAT_TTL * 1000, // 120 seconds
};

const restartHandlers = new Map<string, WorkerRestartHandler>();
const supervisorStates = new Map<string, WorkerSupervisorState>();
let supervisorTimer: NodeJS.Timeout | null = null;

export function registerWorkerRestartHandler(name: string, handler: WorkerRestartHandler): void {
  restartHandlers.set(name, handler);
}

export function unregisterWorkerRestartHandler(name: string): void {
  restartHandlers.delete(name);
}

export function clearWorkerRestartHandlers(): void {
  restartHandlers.clear();
}

export function getRegisteredRestartHandlers(): string[] {
  return Array.from(restartHandlers.keys());
}

export function getWorkerSupervisorState(name: string): WorkerSupervisorState {
  let state = supervisorStates.get(name);
  if (!state) {
    state = {
      name,
      consecutiveMissedHeartbeats: 0,
      restartTimestamps: [],
      inCrashLoop: false,
    };
    supervisorStates.set(name, state);
  }
  return state;
}

export function getAllSupervisorStates(): WorkerSupervisorState[] {
  return Array.from(supervisorStates.values()).map((s) => ({
    ...s,
    restartTimestamps: [...s.restartTimestamps],
  }));
}

export function resetWorkerSupervisorState(name?: string): void {
  if (name) {
    supervisorStates.delete(name);
  } else {
    supervisorStates.clear();
  }
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
  return new redis.Redis(connectionOptions);
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
 * Supervise a specific worker by inspecting its heartbeat,
 * tracking consecutive missed heartbeats, enforcing crash-loop protection,
 * and triggering a restart handler when threshold is reached.
 */
export async function superviseWorker(
  name: string,
  config: Partial<SupervisorConfig> = {}
): Promise<SupervisorCheckResult> {
  const mergedConfig: SupervisorConfig = { ...DEFAULT_SUPERVISOR_CONFIG, ...config };
  const state = getWorkerSupervisorState(name);
  const now = Date.now();

  // Prune timestamps outside the active restart sliding window
  state.restartTimestamps = state.restartTimestamps.filter(
    (t) => now - t <= mergedConfig.restartWindowMs
  );

  // If in crash loop, check if window has cleared below maxRestartAttempts
  if (state.inCrashLoop && state.restartTimestamps.length < mergedConfig.maxRestartAttempts) {
    state.inCrashLoop = false;
  }

  // Retrieve current persisted worker status
  const status = await getPersistedWorkerStatus(name);

  // Determine if heartbeat is present, healthy, and within heartbeat timeout
  const isHeartbeatValid = (() => {
    if (!status) return false;
    if (!status.isHealthy) return false;
    const heartbeatTime = new Date(status.heartbeatAt).getTime();
    if (isNaN(heartbeatTime)) return false;
    return now - heartbeatTime <= mergedConfig.heartbeatTimeoutMs;
  })();

  if (isHeartbeatValid) {
    state.consecutiveMissedHeartbeats = 0;
    return {
      workerName: name,
      action: 'healthy',
      consecutiveMissedHeartbeats: 0,
      restartCountInWindow: state.restartTimestamps.length,
      inCrashLoop: state.inCrashLoop,
    };
  }

  // Heartbeat is missing or stale
  state.consecutiveMissedHeartbeats += 1;
  logger.warn('[WORKER:supervisor] Worker missed heartbeat', {
    name,
    consecutiveMissed: state.consecutiveMissedHeartbeats,
    threshold: mergedConfig.missedHeartbeatThreshold,
  });

  // Check if threshold not yet reached
  if (state.consecutiveMissedHeartbeats < mergedConfig.missedHeartbeatThreshold) {
    return {
      workerName: name,
      action: 'heartbeat_missed',
      consecutiveMissedHeartbeats: state.consecutiveMissedHeartbeats,
      restartCountInWindow: state.restartTimestamps.length,
      inCrashLoop: state.inCrashLoop,
    };
  }

  // Threshold reached - evaluate crash-loop protection
  if (state.restartTimestamps.length >= mergedConfig.maxRestartAttempts) {
    state.inCrashLoop = true;
    state.lastCrashLoopAt = new Date(now).toISOString();
    logger.error('[WORKER:supervisor] Crash-loop protection activated. Maximum restarts reached.', {
      name,
      restartAttemptsInWindow: state.restartTimestamps.length,
      windowMs: mergedConfig.restartWindowMs,
    });
    return {
      workerName: name,
      action: 'crash_loop_prevented',
      consecutiveMissedHeartbeats: state.consecutiveMissedHeartbeats,
      restartCountInWindow: state.restartTimestamps.length,
      inCrashLoop: true,
    };
  }

  // Supervised restart
  const handler = restartHandlers.get(name);
  if (!handler) {
    logger.warn('[WORKER:supervisor] Missing heartbeats detected but no restart handler registered', {
      name,
    });
    return {
      workerName: name,
      action: 'no_handler',
      consecutiveMissedHeartbeats: state.consecutiveMissedHeartbeats,
      restartCountInWindow: state.restartTimestamps.length,
      inCrashLoop: false,
    };
  }

  state.restartTimestamps.push(now);
  state.lastRestartAt = new Date(now).toISOString();
  state.consecutiveMissedHeartbeats = 0; // reset consecutive missed counter on restart initiation

  try {
    logger.info('[WORKER:supervisor] Triggering supervised worker restart', {
      name,
      attemptInWindow: state.restartTimestamps.length,
      maxAttempts: mergedConfig.maxRestartAttempts,
    });
    await handler();
    return {
      workerName: name,
      action: 'restart_triggered',
      consecutiveMissedHeartbeats: 0,
      restartCountInWindow: state.restartTimestamps.length,
      inCrashLoop: false,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('[WORKER:supervisor] Supervised worker restart failed', {
      name,
      error: errorMsg,
    });
    return {
      workerName: name,
      action: 'restart_failed',
      consecutiveMissedHeartbeats: 0,
      restartCountInWindow: state.restartTimestamps.length,
      inCrashLoop: false,
      error: errorMsg,
    };
  }
}

/**
 * Supervise all tracked and persisted workers
 */
export async function superviseAllWorkers(
  config: Partial<SupervisorConfig> = {}
): Promise<SupervisorCheckResult[]> {
  const allNames = new Set<string>();
  const persistedStatuses = await getAllPersistedWorkerStatuses();
  for (const s of persistedStatuses) {
    allNames.add(s.name);
  }
  for (const name of restartHandlers.keys()) {
    allNames.add(name);
  }
  for (const name of supervisorStates.keys()) {
    allNames.add(name);
  }

  const results: SupervisorCheckResult[] = [];
  for (const name of allNames) {
    const result = await superviseWorker(name, config);
    results.push(result);
  }
  return results;
}

/**
 * Start periodic worker supervisor monitoring loop
 */
export function startWorkerSupervisor(
  config: Partial<SupervisorConfig> = {},
  intervalMs: number = 30000
): { stop: () => void } {
  stopWorkerSupervisor();

  supervisorTimer = setInterval(() => {
    void superviseAllWorkers(config).catch((err) => {
      logger.error('[WORKER:supervisor] Error in supervisor cycle', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, intervalMs);

  if (supervisorTimer.unref) {
    supervisorTimer.unref();
  }

  return {
    stop: () => stopWorkerSupervisor(),
  };
}

/**
 * Stop periodic worker supervisor monitoring loop
 */
export function stopWorkerSupervisor(): void {
  if (supervisorTimer) {
    clearInterval(supervisorTimer);
    supervisorTimer = null;
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
      crashLooping: Array.from(supervisorStates.values()).filter(s => s.inCrashLoop).length,
      supervisor: Array.from(supervisorStates.values()),
      workers: statuses
    };

    return summary;
  } catch (error) {
    logger.error('[WORKER:heartbeat] Failed to compute health summary', {
      error: error instanceof Error ? error.message : String(error)
    });
    return { total: 0, healthy: 0, unhealthy: 0, idle: 0, lagging: 0, crashLooping: 0, supervisor: [], workers: [] };
  }
}
