import { Worker, Job } from 'bullmq'
import { getConnectionOptions } from '../connection.js'
import { analyticsService } from '../../services/analyticsService.js'
import { logger } from '../../utils/logger.js'
import type { AnalyticsSnapshotJobData } from '../queues.js'

let worker: Worker | null = null

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
        worker = new Worker(
            'analytics-snapshot',
            processAnalyticsSnapshotJob,
            {
                connection: getConnectionOptions(),
                concurrency: 1,
            }
        )
    } catch (err) {
        logger.warn('[WORKER:analytics-snapshot] Failed to start – Redis may be unavailable', {
            error: err instanceof Error ? err.message : String(err),
        })
        return null
    }

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
        logger.info('[WORKER:analytics-snapshot] Worker stopped')
    }
}
