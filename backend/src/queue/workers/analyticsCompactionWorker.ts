import { Worker, Job } from "bullmq";
import { randomUUID } from "node:crypto";
import { runWithRequestContext } from "../../utils/requestContext.js";
import { getConnectionOptions } from "../connection.js";
import { analyticsService } from "../../services/analyticsService.js";
import { logger } from "../../utils/logger.js";
import type { AnalyticsCompactionJobData } from "../queues.js";
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
} from "./workerRuntime.js";

let worker: Worker | null = null;
const runtimeStatus = createWorkerRuntimeStatus("analytics-compaction", 1);

/**
 * Core processor: triggers compaction of all portfolio analytics snapshots.
 * Extracted as a standalone function so tests can call it directly.
 */
export async function processAnalyticsCompactionJob(
  job: Job<AnalyticsCompactionJobData>,
): Promise<void> {
  const correlationId = (job.data as AnalyticsCompactionJobData).correlationId;
  const requestId = correlationId ?? randomUUID();
  const cutoffDays = (job.data as AnalyticsCompactionJobData).cutoffDays ?? 90;
  const recentDays = (job.data as AnalyticsCompactionJobData).recentDays ?? 7;

  return runWithRequestContext({ requestId }, async () => {
    logger.info("[WORKER:analytics-compaction] Starting analytics snapshot compaction", {
      jobId: job.id,
      triggeredBy: job.data.triggeredBy ?? "scheduler",
      cutoffDays,
      recentDays,
      correlationId,
    });

    const results = await analyticsService.compactAllPortfolios(cutoffDays, recentDays);

    const totalDeleted = results.reduce((sum, r) => sum + r.deletedCount, 0);
    const totalRetained = results.reduce((sum, r) => sum + r.retainedCount, 0);

    logger.info("[WORKER:analytics-compaction] Compaction cycle complete", {
      jobId: job.id,
      portfoliosProcessed: results.length,
      totalSnapshotsDeleted: totalDeleted,
      totalSnapshotsRetained: totalRetained,
    });
  });
}

/**
 * Starts the analytics-compaction BullMQ worker (singleton).
 */
export function startAnalyticsCompactionWorker(): Worker | null {
  if (worker) return worker;

  try {
    markWorkerStarting(runtimeStatus);
    worker = new Worker("analytics-compaction", processAnalyticsCompactionJob, {
      connection: getConnectionOptions(),
      concurrency: 1,
    });
  } catch (err) {
    markWorkerFailed(runtimeStatus, err);
    logger.warn(
      "[WORKER:analytics-compaction] Failed to start – Redis may be unavailable",
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
      logger.info("[WORKER:analytics-compaction] Worker ready");
    })
    .catch((err: unknown) => {
      markWorkerFailed(runtimeStatus, err);
      logger.error(
        "[WORKER:analytics-compaction] Worker failed readiness check",
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
    });

  worker.on("completed", (job: any) => {
    markWorkerJobCompleted(runtimeStatus);
    logger.info("[WORKER:analytics-compaction] Job completed", { jobId: job.id });
  });

  worker.on("failed", (job: any, err: any) => {
    markWorkerJobFailed(runtimeStatus, err);
    logger.error("[WORKER:analytics-compaction] Job failed", {
      jobId: job?.id,
      error: err.message,
      attemptsMade: job?.attemptsMade,
    });
  });

  logger.info("[WORKER:analytics-compaction] Worker started");
  return worker;
}

export async function stopAnalyticsCompactionWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    markWorkerStopped(runtimeStatus);
    logger.info("[WORKER:analytics-compaction] Worker stopped");
  }
}

export function getAnalyticsCompactionWorkerStatus(): WorkerRuntimeStatus {
  return snapshotWorkerRuntimeStatus(runtimeStatus);
}

export function setAnalyticsCompactionSchedulerRegistered(
  registered: boolean,
): void {
  runtimeStatus.schedulerRegistered = registered;
}
