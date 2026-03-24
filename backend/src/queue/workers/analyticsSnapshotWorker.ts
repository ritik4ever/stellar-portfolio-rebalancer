import { Worker, Job } from 'bullmq'
import { getConnectionOptions } from '../connection.js'
import { analyticsService } from '../../services/analyticsService.js'
import { logger } from '../../utils/logger.js'
import type { AnalyticsSnapshotJobData } from '../queues.js'
import {
    createWorkerRuntimeStatus,
    markWorkerFailed,
    markWorkerReady,
    markWorkerStarting,
    markWorkerStopped,
    snapshotWorkerRuntimeStatus,
    type WorkerRuntimeStatus
} from './workerRuntime.js'

let worker: Worker | null = null
const runtimeStatus = createWorkerRuntimeStatus('analytics-snapshot', 1)

/**
 * Core processor: triggers a snapshot of all portfolios.
 * Extracted as a standalone function so tests can call it directly.
 */
export async function processAnalyticsSnapshotJob(
    job: Job<AnalyticsSnapshotJobData>
): Promise<void> {
    logger.info('[WORKER:analytics-snapshot] Capturing portfolio snapshots', {
        jobId: job.id,
        triggeredBy: job.data.triggeredBy ?? 'scheduler',
    })

    await analyticsService.captureAllPortfolios()

    logger.info('[WORKER:analytics-snapshot] Snapshot cycle complete', {
        jobId: job.id,
    })
}

/**
 * Starts the analytics-snapshot BullMQ worker (singleton).
 */
export function startAnalyticsSnapshotWorker(): Worker | null {
    if (worker) return worker

    try {
        markWorkerStarting(runtimeStatus)
        worker = new Worker(
            'analytics-snapshot',
            processAnalyticsSnapshotJob,
            {
                connection: getConnectionOptions(),
                concurrency: 1,
            }
        )
    } catch (err) {
        markWorkerFailed(runtimeStatus, err)
        logger.warn('[WORKER:analytics-snapshot] Failed to start – Redis may be unavailable', {
            error: err instanceof Error ? err.message : String(err),
        })
        return null
    }

    void worker.waitUntilReady()
        .then(() => {
            markWorkerReady(runtimeStatus)
            logger.info('[WORKER:analytics-snapshot] Worker ready')
        })
        .catch((err) => {
            markWorkerFailed(runtimeStatus, err)
            logger.error('[WORKER:analytics-snapshot] Worker failed readiness check', {
                error: err instanceof Error ? err.message : String(err),
            })
        })

    worker.on('completed', (job) => {
        logger.info('[WORKER:analytics-snapshot] Job completed', { jobId: job.id })
    })

    worker.on('failed', (job, err) => {
        logger.error('[WORKER:analytics-snapshot] Job failed', {
            jobId: job?.id,
            error: err.message,
            attemptsMade: job?.attemptsMade,
        })
    })

    logger.info('[WORKER:analytics-snapshot] Worker started')
    return worker
}

export async function stopAnalyticsSnapshotWorker(): Promise<void> {
    if (worker) {
        await worker.close()
        worker = null
        markWorkerStopped(runtimeStatus)
        logger.info('[WORKER:analytics-snapshot] Worker stopped')
    }
}

export function getAnalyticsSnapshotWorkerStatus(): WorkerRuntimeStatus {
    return snapshotWorkerRuntimeStatus(runtimeStatus)
}
