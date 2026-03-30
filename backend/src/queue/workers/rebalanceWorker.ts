import type { Job } from 'bullmq'
import { Worker } from 'bullmq'
import { logger, logAudit } from '../../utils/logger.js'
import { rebalanceLockService } from '../../services/rebalanceLock.js'
import { StellarService } from '../../services/stellar.js'
import { rebalanceHistoryService } from '../../services/serviceContainer.js'
import { notificationService } from '../../services/notificationService.js'
import { getConnectionOptions } from '../connection.js'
import type { RebalanceJobData } from '../queues.js'
import {
    createWorkerRuntimeStatus,
    markWorkerFailed,
    markWorkerJobCompleted,
    markWorkerJobFailed,
    markWorkerReady,
    markWorkerStarting,
    markWorkerStopped,
    snapshotWorkerRuntimeStatus,
    type WorkerRuntimeStatus,
} from './workerRuntime.js'

let worker: Worker | null = null
const runtimeStatus = createWorkerRuntimeStatus('rebalance', 3)

/**
 * Core processor: executes a single portfolio rebalance.
 * Extracted as a standalone function so tests can call it directly.
 */
export async function processRebalanceJob(
  job: Job<RebalanceJobData>,
): Promise<void> {
  const { portfolioId, triggeredBy } = job.data;

  logger.info("[WORKER:rebalance] Executing rebalance", {
    jobId: job.id,
    portfolioId,
    triggeredBy,
  });
  if (triggeredBy === "auto") {
    logAudit("auto_rebalance_started", {
      portfolioId,
      jobId: job.id,
    });
  }

  const lockAcquired = await rebalanceLockService.acquireLock(portfolioId);

  if (!lockAcquired) {
    logger.info("[WORKER:rebalance] Rebalance already in progress. Aborting.", {
      portfolioId,
    });
    return;
  }

  const stellarService = new StellarService();
  try {
    const portfolio = await stellarService.getPortfolio(portfolioId);
    const rebalanceResult = await stellarService.executeRebalance(portfolioId);

    await rebalanceHistoryService.recordRebalanceEvent({
      portfolioId,
      trigger:
        triggeredBy === "auto" ? "Automatic Rebalancing" : "Manual Rebalancing",
      trades: rebalanceResult.trades ?? 0,
      gasUsed: rebalanceResult.gasUsed ?? "0 XLM",
      status: "completed",
      isAutomatic: triggeredBy === "auto",
    });

    try {
      await notificationService.notify({
        userId: portfolio.userAddress,
        eventType: "rebalance",
        title: "Portfolio Rebalanced",
        message: `Your portfolio has been automatically rebalanced. ${rebalanceResult.trades ?? 0} trades executed with ${rebalanceResult.gasUsed ?? "0 XLM"} gas used.`,
        data: {
          portfolioId,
          trades: rebalanceResult.trades,
          gasUsed: rebalanceResult.gasUsed,
          trigger: triggeredBy,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (notifyErr) {
      logger.error("[WORKER:rebalance] Notification failed (non-fatal)", {
        portfolioId,
        error:
          notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
      });
    }

    logger.info("[WORKER:rebalance] Rebalance completed", {
      portfolioId,
      trades: rebalanceResult.trades,
    });
    if (triggeredBy === "auto") {
      logAudit("auto_rebalance_completed", {
        portfolioId,
        jobId: job.id,
        trades: rebalanceResult.trades ?? 0,
        status: "completed",
      });
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    try {
      await rebalanceHistoryService.recordRebalanceEvent({
        portfolioId,
        trigger: `Automatic Rebalancing (Failed – attempt ${job.attemptsMade + 1})`,
        trades: 0,
        gasUsed: "0 XLM",
        status: "failed",
        isAutomatic: triggeredBy === "auto",
        error: errorMessage,
      });
    } catch (histErr) {
      logger.error("[WORKER:rebalance] Failed to record failure event", {
        histErr,
      });
    }

    logger.error("[WORKER:rebalance] Rebalance failed", {
      portfolioId,
      error: errorMessage,
      attemptsMade: job.attemptsMade,
    });
    if (triggeredBy === "auto") {
      logAudit("auto_rebalance_failed", {
        portfolioId,
        jobId: job.id,
        error: errorMessage,
        attemptsMade: job.attemptsMade,
      });
    }

    throw err;
  } finally {
    await rebalanceLockService.releaseLock(portfolioId);
  }
}

export function startRebalanceWorker(): Worker | null {
  if (worker) return worker;

  try {
    markWorkerStarting(runtimeStatus);
    worker = new Worker("rebalance", processRebalanceJob, {
      connection: getConnectionOptions(),
      concurrency: 3,
    });
  } catch (err) {
    markWorkerFailed(runtimeStatus, err);
    logger.warn(
      "[WORKER:rebalance] Failed to start – Redis may be unavailable",
      {
        error: err instanceof Error ? err.message : String(err),
      },
    );
    return null;
  }

  void worker
    .waitUntilReady()
    .then(() => {
      markWorkerReady(runtimeStatus);
      logger.info("[WORKER:rebalance] Worker ready");
    })
    .catch((err) => {
      markWorkerFailed(runtimeStatus, err);
      logger.error("[WORKER:rebalance] Worker failed readiness check", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

  worker.on("completed", (j: Job) => {
    logger.info("[WORKER:rebalance] Job completed", {
      jobId: j.id,
      portfolioId: j.data.portfolioId,
    });
  });

  worker.on("failed", (j: Job | undefined, err: Error) => {
    logger.error("[WORKER:rebalance] Job failed", {
      jobId: j?.id,
      portfolioId: j?.data.portfolioId,
      error: err.message,
      attemptsMade: j?.attemptsMade,
    });
  });

  logger.info("[WORKER:rebalance] Worker started (concurrency=3)");
  return worker;
}

export async function stopRebalanceWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    markWorkerStopped(runtimeStatus);
    logger.info("[WORKER:rebalance] Worker stopped");
  }
}

export function isRebalanceWorkerRunning(): boolean {
  return worker !== null;
}

export function getRebalanceWorkerStatus(): WorkerRuntimeStatus {
  return snapshotWorkerRuntimeStatus(runtimeStatus);
}

export function getRebalanceWorkerStatus(): WorkerRuntimeStatus {
    return snapshotWorkerRuntimeStatus(runtimeStatus)
}
