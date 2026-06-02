import { databaseService } from "../services/databaseService.js";
import {
  getPortfolioCheckQueue,
  getRebalanceQueue,
  getAnalyticsSnapshotQueue,
  getAnalyticsCompactionQueue,
  QUEUE_NAMES,
} from "../queue/queues.js";
import { isRedisAvailable } from "../queue/connection.js";
import { contractEventIndexerService } from "../services/contractEventIndexer.js";
import { autoRebalancer } from "../services/runtimeServices.js";
import { getPortfolioCheckWorkerStatus } from "../queue/workers/portfolioCheckWorker.js";
import { getRebalanceWorkerStatus } from "../queue/workers/rebalanceWorker.js";
import { getAnalyticsSnapshotWorkerStatus } from "../queue/workers/analyticsSnapshotWorker.js";
import { getAnalyticsCompactionWorkerStatus } from "../queue/workers/analyticsCompactionWorker.js";
import { logger } from "../utils/logger.js";

type ReadinessState = "ready" | "not_ready" | "disabled";

// ── Readiness cache ─────────────────────────────────────────────────────────
interface CacheEntry {
  report: object
  expiresAt: number
}

let cacheTtlMs = parseInt(process.env.READINESS_CACHE_TTL_MS || "2000", 10)
if (!Number.isInteger(cacheTtlMs) || cacheTtlMs < 0) cacheTtlMs = 2000

let cache: CacheEntry | null = null

export function setReadinessCacheTtl(ttlMs: number): void {
  cacheTtlMs = ttlMs
}

export function clearReadinessCache(): void {
  cache = null
}

interface ReadinessCheck {
  status: ReadinessState;
  required: boolean;
  message: string;
  details?: Record<string, unknown>;
}

function buildCheck(
  status: ReadinessState,
  required: boolean,
  message: string,
  details?: Record<string, unknown>,
): ReadinessCheck {
  return { status, required, message, details };
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);
}

async function checkQueueReady(
  name: string,
  queue: { waitUntilReady(): Promise<unknown> } | null,
): Promise<ReadinessCheck> {
  if (!queue) {
    return buildCheck("not_ready", true, `${name} queue is not initialized`);
  }

  try {
    const start = Date.now()
    await withTimeout(
      queue.waitUntilReady(),
      3000,
      `${name} queue readiness timed out`,
    );
    const latencyMs = Date.now() - start
    return buildCheck("ready", true, `${name} queue is ready`, { latencyMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildCheck("not_ready", true, `${name} queue is unavailable`, {
      error: message,
      latencyMs: null,
      degradedReason: message,
    });
  }
}

export async function buildReadinessReport() {
  const now = Date.now()
  if (cache && cache.expiresAt > now) {
    return cache.report
  }

  // Measure database readiness latency
  let databaseCheck: ReadinessCheck
  try {
    const start = Date.now()
    const db = databaseService.getReadiness()
    const latencyMs = Date.now() - start
    databaseCheck = db.ready
      ? buildCheck("ready", true, "Database connection is healthy", {
          ...db,
          latencyMs,
        })
      : buildCheck("not_ready", true, "Database connection check failed", {
          ...db,
          latencyMs,
          degradedReason: db.error,
        })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    databaseCheck = buildCheck("not_ready", true, "Database readiness check threw", {
      error: message,
      latencyMs: null,
      degradedReason: message,
    })
  }

  const redisConnected = await isRedisAvailable();

  const portfolioQueueCheck = redisConnected
    ? await checkQueueReady(
        QUEUE_NAMES.PORTFOLIO_CHECK,
        getPortfolioCheckQueue(),
      )
    : buildCheck(
        "disabled",
        false,
        "Queue subsystem disabled — Redis unavailable",
      );

  const rebalanceQueueCheck = redisConnected
    ? await checkQueueReady(QUEUE_NAMES.REBALANCE, getRebalanceQueue())
    : buildCheck(
        "disabled",
        false,
        "Queue subsystem disabled — Redis unavailable",
      );

  const analyticsQueueCheck = redisConnected
    ? await checkQueueReady(
        QUEUE_NAMES.ANALYTICS_SNAPSHOT,
        getAnalyticsSnapshotQueue(),
      )
    : buildCheck(
        "disabled",
        false,
        "Queue subsystem disabled — Redis unavailable",
      );

  const analyticsCompactionQueueCheck = redisConnected
    ? await checkQueueReady(
        QUEUE_NAMES.ANALYTICS_COMPACTION,
        getAnalyticsCompactionQueue(),
      )
    : buildCheck(
        "disabled",
        false,
        "Queue subsystem disabled — Redis unavailable",
      );

  const queueCheck = !redisConnected
    ? buildCheck(
        "disabled",
        false,
        "Queue subsystem disabled — Redis unavailable. Set REDIS_URL to enable BullMQ.",
        {
          redisConnected,
          queues: {
            [QUEUE_NAMES.PORTFOLIO_CHECK]: portfolioQueueCheck,
            [QUEUE_NAMES.REBALANCE]: rebalanceQueueCheck,
            [QUEUE_NAMES.ANALYTICS_SNAPSHOT]: analyticsQueueCheck,
            [QUEUE_NAMES.ANALYTICS_COMPACTION]: analyticsCompactionQueueCheck,
          },
        },
      )
    : portfolioQueueCheck.status === "ready" &&
        rebalanceQueueCheck.status === "ready" &&
        analyticsQueueCheck.status === "ready" &&
        analyticsCompactionQueueCheck.status === "ready"
      ? buildCheck("ready", true, "Redis and BullMQ queues are ready", {
          redisConnected,
          queues: {
            [QUEUE_NAMES.PORTFOLIO_CHECK]: portfolioQueueCheck,
            [QUEUE_NAMES.REBALANCE]: rebalanceQueueCheck,
            [QUEUE_NAMES.ANALYTICS_SNAPSHOT]: analyticsQueueCheck,
            [QUEUE_NAMES.ANALYTICS_COMPACTION]: analyticsCompactionQueueCheck,
          },
        })
      : buildCheck("not_ready", true, "Queue subsystem is not ready", {
          redisConnected,
          queues: {
            [QUEUE_NAMES.PORTFOLIO_CHECK]: portfolioQueueCheck,
            [QUEUE_NAMES.REBALANCE]: rebalanceQueueCheck,
            [QUEUE_NAMES.ANALYTICS_SNAPSHOT]: analyticsQueueCheck,
            [QUEUE_NAMES.ANALYTICS_COMPACTION]: analyticsCompactionQueueCheck,
          },
        });

  const workerStatuses = {
    portfolioCheck: getPortfolioCheckWorkerStatus(),
    rebalance: getRebalanceWorkerStatus(),
    analyticsSnapshot: getAnalyticsSnapshotWorkerStatus(),
    analyticsCompaction: getAnalyticsCompactionWorkerStatus(),
  };

  const workersReady = Object.values(workerStatuses).every(
    (status) => status.started && status.ready,
  );
  const workersCheck = !redisConnected
    ? buildCheck(
        "disabled",
        false,
        "Workers disabled — Redis unavailable",
        workerStatuses as unknown as Record<string, unknown>,
      )
    : workersReady
      ? buildCheck(
          "ready",
          true,
          "All queue workers are ready",
          workerStatuses as unknown as Record<string, unknown>,
        )
      : buildCheck(
          "not_ready",
          true,
          "One or more queue workers are not ready",
          workerStatuses as unknown as Record<string, unknown>,
        );

  const indexerStatus = contractEventIndexerService.getStatus();
  const indexerRequired = indexerStatus.enabled;
  let indexerCheck: ReadinessCheck;
  if (!indexerRequired) {
    indexerCheck = buildCheck(
      "disabled",
      false,
      "Contract event indexer is disabled",
      indexerStatus as unknown as Record<string, unknown>,
    );
  } else if (!indexerStatus.contractEventSchemaOk) {
    indexerCheck = buildCheck(
      "not_ready",
      true,
      indexerStatus.lastError ||
        "Contract event schema version does not match this backend",
      indexerStatus as unknown as Record<string, unknown>,
    );
  } else if (
    indexerStatus.running &&
    !!indexerStatus.lastSuccessfulRunAt &&
    !indexerStatus.lastError
  ) {
    indexerCheck = buildCheck(
      "ready",
      true,
      "Contract event indexer is ready",
      indexerStatus as unknown as Record<string, unknown>,
    );
  } else if (indexerStatus.consecutiveFailures > 0 && indexerStatus.lastSuccessfulRunAt) {
    indexerCheck = buildCheck(
      "not_ready",
      true,
      `Contract event indexer degraded (${indexerStatus.consecutiveFailures} consecutive failures)`,
      indexerStatus as unknown as Record<string, unknown>,
    );
  } else {
    indexerCheck = buildCheck(
      "not_ready",
      true,
      "Contract event indexer has not completed a successful startup sync",
      indexerStatus as unknown as Record<string, unknown>,
    );
  }

  const autoRebalancerEnabled =
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_AUTO_REBALANCER === "true";
  const autoRebalancerStatus = autoRebalancer.getStatus();
  const autoRebalancerCheck = !autoRebalancerEnabled
    ? buildCheck(
        "disabled",
        false,
        "Auto-rebalancer is disabled for this environment",
        autoRebalancerStatus as unknown as Record<string, unknown>,
      )
    : autoRebalancerStatus.isRunning && autoRebalancerStatus.initialized
      ? buildCheck(
          "ready",
          true,
          "Auto-rebalancer is initialized",
          autoRebalancerStatus as unknown as Record<string, unknown>,
        )
      : buildCheck(
          "not_ready",
          true,
          "Auto-rebalancer is enabled but not initialized",
          autoRebalancerStatus as unknown as Record<string, unknown>,
        );

  const checks = {
    database: databaseCheck,
    queue: queueCheck,
    workers: workersCheck,
    contractEventIndexer: indexerCheck,
    autoRebalancer: autoRebalancerCheck,
  };

  const ready = Object.values(checks).every(
    (check) => !check.required || check.status === "ready",
  );

  // Surface probe-bypass config for ops visibility (secret value is NEVER
  // included — only whether one is configured).
  const probeBypass = {
    probePaths: ["/health", "/ready", "/readiness", "/metrics"],
    loopbackBypassEnabled: true,
    secretConfigured: Boolean(process.env.HEALTH_PROBE_SECRET),
  };

  const report = {
    status: ready ? "ready" : "not_ready",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    checks,
    probeBypass,
  };

  if (cacheTtlMs > 0) {
    cache = { report, expiresAt: now + cacheTtlMs }
  }

  return report
}
