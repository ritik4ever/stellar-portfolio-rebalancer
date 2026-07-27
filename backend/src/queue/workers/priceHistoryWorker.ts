import { Worker, Job } from 'bullmq'
import { getConnectionOptions } from '../connection.js'
import { snapshotPrices, pruneStaleSnapshots } from '../../services/priceHistory.js'
import { logger } from '../../utils/logger.js'
import type { PriceHistoryJobData } from '../queues.js'

let snapshotWorker: Worker | null = null
let pruneWorker: Worker | null = null

export async function processPriceHistorySnapshotJob(job: Job<PriceHistoryJobData>): Promise<void> {
    logger.info('[WORKER:price-history-snapshot] Capturing price snapshot', {
        jobId: job.id,
        triggeredBy: job.data.triggeredBy ?? 'scheduler',
    })
    await snapshotPrices()
}

export async function processPriceHistoryPruneJob(job: Job<PriceHistoryJobData>): Promise<void> {
    logger.info('[WORKER:price-history-prune] Running daily prune', { jobId: job.id })
    await pruneStaleSnapshots()
}

export function startPriceHistoryWorkers(): void {
    if (!snapshotWorker) {
        try {
            snapshotWorker = new Worker('price-history-snapshot', processPriceHistorySnapshotJob, {
                connection: getConnectionOptions(),
                concurrency: 1,
            })
            snapshotWorker.on('failed', (job, err) => {
                logger.error('[WORKER:price-history-snapshot] Job failed', {
                    jobId: job?.id,
                    error: err.message,
                })
            })
            logger.info('[WORKER:price-history-snapshot] Worker started')
        } catch {
            logger.warn('[WORKER:price-history-snapshot] Failed to start — Redis unavailable')
        }
    }

    if (!pruneWorker) {
        try {
            pruneWorker = new Worker('price-history-prune', processPriceHistoryPruneJob, {
                connection: getConnectionOptions(),
                concurrency: 1,
            })
            pruneWorker.on('failed', (job, err) => {
                logger.error('[WORKER:price-history-prune] Job failed', {
                    jobId: job?.id,
                    error: err.message,
                })
            })
            logger.info('[WORKER:price-history-prune] Worker started')
        } catch {
            logger.warn('[WORKER:price-history-prune] Failed to start — Redis unavailable')
        }
    }
}

export async function stopPriceHistoryWorkers(): Promise<void> {
    await snapshotWorker?.close()
    await pruneWorker?.close()
    snapshotWorker = null
    pruneWorker = null
}
