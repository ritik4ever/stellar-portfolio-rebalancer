import { databaseService } from "../services/databaseService.js";
import {
  getPortfolioCheckQueue,
  getRebalanceQueue,
  getAnalyticsSnapshotQueue,
  QUEUE_NAMES,
} from "../queue/queues.js";
import { isRedisAvailable } from "../queue/connection.js";
import { contractEventIndexerService } from "../services/contractEventIndexer.js";
import { autoRebalancer } from "../services/runtimeServices.js";
import { getPortfolioCheckWorkerStatus } from "../queue/workers/portfolioCheckWorker.js";
import { getRebalanceWorkerStatus } from "../queue/workers/rebalanceWorker.js";
import { getAnalyticsSnapshotWorkerStatus } from "../queue/workers/analyticsSnapshotWorker.js";

type ReadinessState = "ready" | "not_ready" | "disabled";

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
    await withTimeout(
      queue.waitUntilReady(),
      3000,
      `${name} queue readiness timed out`,
    );
    return buildCheck("ready", true, `${name} queue is ready`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildCheck("not_ready", true, `${name} queue is unavailable`, {
      error: message,
    });
  }
}

export async function buildReadinessReport() {
  const database = databaseService.getReadiness();
  const databaseCheck = database.ready
    ? buildCheck("ready", true, "Database connection is healthy", database)
    : buildCheck(
        "not_ready",
        true,
        "Database connection check failed",
        database,
      );

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
          },
        },
      )
    : portfolioQueueCheck.status === "ready" &&
        rebalanceQueueCheck.status === "ready" &&
        analyticsQueueCheck.status === "ready"
      ? buildCheck("ready", true, "Redis and BullMQ queues are ready", {
          redisConnected,
          queues: {
            [QUEUE_NAMES.PORTFOLIO_CHECK]: portfolioQueueCheck,
            [QUEUE_NAMES.REBALANCE]: rebalanceQueueCheck,
            [QUEUE_NAMES.ANALYTICS_SNAPSHOT]: analyticsQueueCheck,
          },
        })
      : buildCheck("not_ready", true, "Queue subsystem is not ready", {
          redisConnected,
          queues: {
            [QUEUE_NAMES.PORTFOLIO_CHECK]: portfolioQueueCheck,
            [QUEUE_NAMES.REBALANCE]: rebalanceQueueCheck,
            [QUEUE_NAMES.ANALYTICS_SNAPSHOT]: analyticsQueueCheck,
          },
        });

  const workerStatuses = {
    portfolioCheck: getPortfolioCheckWorkerStatus(),
    rebalance: getRebalanceWorkerStatus(),
    analyticsSnapshot: getAnalyticsSnapshotWorkerStatus(),
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
  const indexerCheck = !indexerRequired
    ? buildCheck(
        "disabled",
        false,
        "Contract event indexer is disabled",
        indexerStatus as unknown as Record<string, unknown>,
      )
    : !indexerStatus.contractEventSchemaOk
      ? buildCheck(
          "not_ready",
          true,
          indexerStatus.lastError ||
            "Contract event schema version does not match this backend",
          indexerStatus as unknown as Record<string, unknown>,
        )
      : indexerStatus.running &&
          !!indexerStatus.lastSuccessfulRunAt &&
          !indexerStatus.lastError
        ? buildCheck(
            "ready",
            true,
            "Contract event indexer is ready",
            indexerStatus as unknown as Record<string, unknown>,
          )
        : buildCheck(
            "not_ready",
            true,
            "Contract event indexer has not completed a successful startup sync",
            indexerStatus as unknown as Record<string, unknown>,
          );

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

  return {
    status: ready ? "ready" : "not_ready",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    checks,
  };
}
