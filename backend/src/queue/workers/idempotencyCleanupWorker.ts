import { Worker, Job } from "bullmq";
import { randomUUID } from "node:crypto";
import { runWithRequestContext } from "../../utils/requestContext.js";
import { getConnectionOptions } from "../connection.js";
import { dbCleanupExpiredIdempotencyKeys } from "../../db/idempotencyDb.js";
import { logger } from "../../utils/logger.js";
import type { IdempotencyCleanupJobData } from "../queues.js";
import { recordIdempotencyCleanupRun } from '../../observability/metrics.js'
import { sendOperationalAlert } from '../../observability/operationalAlerts.js'
import {
  createWorkerRuntimeStatus,
  markWorkerFailed,
  markWorkerJobCompleted,
  markWorkerJobFailed,
  markWorkerReady,
  markWorkerStarting,
  markWorkerStopped,
  snapshotWorkerRuntimeStatus,
  handleFinalFailure,
  type WorkerRuntimeStatus,
} from "./workerRuntime.js";

let worker: Worker | null = null;
let deadManTimer: NodeJS.Timeout | null = null
const runtimeStatus = createWorkerRuntimeStatus("idempotency-cleanup", 1);
let consecutiveFailures = 0
let lastRunAt = 0
let lastDeadManAlertAt = 0
const failureAlertThreshold = Number(process.env.IDEMPOTENCY_CLEANUP_FAILURE_ALERT_THRESHOLD || 3)
const expectedIntervalMs = Number(process.env.IDEMPOTENCY_CLEANUP_EXPECTED_INTERVAL_MS || 60 * 60 * 1000)

/**
 * Core processor: deletes expired idempotency keys from the database.
 * Extracted as a standalone function so tests can call it directly.
 */
export async function processIdempotencyCleanupJob(
  job: Job<IdempotencyCleanupJobData>,
): Promise<void> {
  const correlationId = (job.data as IdempotencyCleanupJobData).correlationId;
  const requestId = correlationId ?? randomUUID();

  return runWithRequestContext({ requestId }, async () => {
    logger.info("[WORKER:idempotency-cleanup] Running cleanup cycle", {
      jobId: job.id,
      triggeredBy: job.data.triggeredBy ?? "scheduler",
      correlationId,
    });

    try {
      const deleted = dbCleanupExpiredIdempotencyKeys();
      consecutiveFailures = 0
      lastRunAt = Date.now()
      recordIdempotencyCleanupRun(true, deleted, consecutiveFailures)
      logger.info("[WORKER:idempotency-cleanup] Cleanup complete", { jobId: job.id, outcome: 'success', expiredKeysRemoved: deleted });
    } catch (error) {
      consecutiveFailures++
      lastRunAt = Date.now()
      recordIdempotencyCleanupRun(false, 0, consecutiveFailures)
      logger.error('[WORKER:idempotency-cleanup] Cleanup failed', { jobId: job.id, outcome: 'failure', recordsCleaned: 0, consecutiveFailures, error: error instanceof Error ? error.message : String(error) })
      if (consecutiveFailures >= failureAlertThreshold) {
        await sendOperationalAlert('Idempotency cleanup is repeatedly failing', { consecutiveFailures, jobId: job.id, error: error instanceof Error ? error.message : String(error) })
      }
      throw error
    }
  });
}

export async function checkIdempotencyCleanupDeadMan(now = Date.now()): Promise<boolean> {
  if (lastRunAt === 0) lastRunAt = now
  const overdue = now - lastRunAt > expectedIntervalMs * 2
  if (overdue && now - lastDeadManAlertAt > expectedIntervalMs) {
    lastDeadManAlertAt = now
    await sendOperationalAlert('Idempotency cleanup worker missed its expected interval', { lastRunAt: new Date(lastRunAt).toISOString(), expectedIntervalMs })
  }
  return overdue
}

/**
 * Starts the idempotency-cleanup BullMQ worker (singleton).
 */
export function startIdempotencyCleanupWorker(): Worker | null {
  if (worker) return worker;

  try {
    markWorkerStarting(runtimeStatus);
    worker = new Worker("idempotency-cleanup", processIdempotencyCleanupJob, {
      connection: getConnectionOptions(),
      concurrency: 1,
    });
  } catch (err) {
    markWorkerFailed(runtimeStatus, err);
    logger.warn(
      "[WORKER:idempotency-cleanup] Failed to start – Redis may be unavailable",
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
      logger.info("[WORKER:idempotency-cleanup] Worker ready");
    })
    .catch((err) => {
      markWorkerFailed(runtimeStatus, err);
      logger.error(
        "[WORKER:idempotency-cleanup] Worker failed readiness check",
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
    });

  worker.on("completed", (job) => {
    markWorkerJobCompleted(runtimeStatus);
    logger.info("[WORKER:idempotency-cleanup] Job completed", {
      jobId: job.id,
    });
  });

  worker.on("failed", (job, err) => {
    markWorkerJobFailed(runtimeStatus, err);
    logger.error("[WORKER:idempotency-cleanup] Job failed", {
      jobId: job?.id,
      error: err.message,
      attemptsMade: job?.attemptsMade,
    });
    void handleFinalFailure(job, err);
  });

  logger.info("[WORKER:idempotency-cleanup] Worker started");
  if (!deadManTimer) {
    deadManTimer = setInterval(() => { void checkIdempotencyCleanupDeadMan() }, expectedIntervalMs)
    deadManTimer.unref()
  }
  return worker;
}

export async function stopIdempotencyCleanupWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    markWorkerStopped(runtimeStatus);
    logger.info("[WORKER:idempotency-cleanup] Worker stopped");
  }
  if (deadManTimer) {
    clearInterval(deadManTimer)
    deadManTimer = null
  }
}

export function getIdempotencyCleanupWorkerStatus(): WorkerRuntimeStatus {
  return snapshotWorkerRuntimeStatus(runtimeStatus);
}

export function setIdempotencyCleanupSchedulerRegistered(
  registered: boolean,
): void {
  runtimeStatus.schedulerRegistered = registered;
}
