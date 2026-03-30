import { Worker, Job } from 'bullmq'
import { getConnectionOptions } from '../connection.js'
import { dbCleanupExpiredIdempotencyKeys } from '../../db/idempotencyDb.js'
import { logger } from '../../utils/logger.js'
import type { IdempotencyCleanupJobData } from '../queues.js'
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
const runtimeStatus = createWorkerRuntimeStatus('idempotency-cleanup', 1)

/**
 * Core processor: deletes expired idempotency keys from the database.
 * Extracted as a standalone function so tests can call it directly.
 */
export async function processIdempotencyCleanupJob(
    job: Job<IdempotencyCleanupJobData>,
): Promise<void> {
    logger.info('[WORKER:idempotency-cleanup] Running cleanup cycle', {
        jobId: job.id,
        triggeredBy: job.data.triggeredBy ?? 'scheduler',
    })

    const deleted = dbCleanupExpiredIdempotencyKeys()

    logger.info('[WORKER:idempotency-cleanup] Cleanup complete', {
        jobId: job.id,
        expiredKeysRemoved: deleted,
    })
}

/**
 * Starts the idempotency-cleanup BullMQ worker (singleton).
 */
export function startIdempotencyCleanupWorker(): Worker | null {
    if (worker) return worker

    try {
        markWorkerStarting(runtimeStatus)
        worker = new Worker(
            'idempotency-cleanup',
            processIdempotencyCleanupJob,
            {
                connection: getConnectionOptions(),
                concurrency: 1,
            }
        )
    } catch (err) {
        markWorkerFailed(runtimeStatus, err)
        logger.warn('[WORKER:idempotency-cleanup] Failed to start – Redis may be unavailable', {
            error: err instanceof Error ? err.message : String(err),
        })
        return null
    }

    void worker.waitUntilReady()
        .then(() => {
            markWorkerReady(runtimeStatus)
            logger.info('[WORKER:idempotency-cleanup] Worker ready')
        })
        .catch((err) => {
            markWorkerFailed(runtimeStatus, err)
            logger.error('[WORKER:idempotency-cleanup] Worker failed readiness check', {
                error: err instanceof Error ? err.message : String(err),
            })
        })

    worker.on('completed', (job) => {
        markWorkerJobCompleted(runtimeStatus)
        logger.info('[WORKER:idempotency-cleanup] Job completed', { jobId: job.id })
    })

    worker.on('failed', (job, err) => {
        markWorkerJobFailed(runtimeStatus, err)
        logger.error('[WORKER:idempotency-cleanup] Job failed', {
            jobId: job?.id,
            error: err.message,
            attemptsMade: job?.attemptsMade,
        })
    })

    logger.info('[WORKER:idempotency-cleanup] Worker started')
    return worker
}

export async function stopIdempotencyCleanupWorker(): Promise<void> {
    if (worker) {
        await worker.close()
        worker = null
        markWorkerStopped(runtimeStatus)
        logger.info('[WORKER:idempotency-cleanup] Worker stopped')
    }
}

export function getIdempotencyCleanupWorkerStatus(): WorkerRuntimeStatus {
    return snapshotWorkerRuntimeStatus(runtimeStatus)
}

export function setIdempotencyCleanupSchedulerRegistered(registered: boolean): void {
    runtimeStatus.schedulerRegistered = registered
}
