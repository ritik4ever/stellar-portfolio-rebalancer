import { Worker, Job } from 'bullmq'
import { getConnectionOptions, isRedisAvailable } from '../connection.js'
import {
    snapshotPrices,
    pruneStaleSnapshots,
    backfillPriceHistory,
} from '../../services/priceHistory.js'
import { logger } from '../../utils/logger.js'
import type { PriceHistoryJobData, PriceHistoryBackfillJobData } from '../queues.js'
import { getPriceHistoryBackfillQueue } from '../queues.js'

let snapshotWorker: Worker | null = null
let pruneWorker: Worker | null = null
let backfillWorker: Worker | null = null

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

export async function processPriceHistoryBackfillJob(
    job: Job<PriceHistoryBackfillJobData>,
): Promise<{ asset: string; backfilled: number; days: number }> {
    const { asset, days } = job.data
    if (!asset) {
        throw new Error('asset is required for price-history-backfill job')
    }
    logger.info('[WORKER:price-history-backfill] Backfilling asset history', {
        jobId: job.id,
        asset,
        days: days ?? 'config-default',
    })
    return backfillPriceHistory(asset, days)
}

/**
 * Best-effort scheduler for the price-history backfill job. Enqueues a job
 * when Redis and the queue are available; otherwise returns false so callers
 * can log/skip without blocking. Safe to fire-and-forget from request paths.
 */
export async function schedulePriceHistoryBackfill(
    asset: string,
    days?: number,
): Promise<boolean> {
    try {
        if (!(await isRedisAvailable())) {
            logger.warn('[WORKER:price-history-backfill] Redis unavailable — backfill not scheduled', {
                asset,
            })
            return false
        }
        const queue = getPriceHistoryBackfillQueue()
        if (!queue) return false

        await queue.add(
            'backfill',
            { asset, days, triggeredBy: 'asset_added' },
            {
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: true,
                removeOnFail: 100,
            },
        )
        logger.info('[WORKER:price-history-backfill] Backfill scheduled', { asset, days })
        return true
    } catch (err) {
        logger.error('[WORKER:price-history-backfill] Failed to schedule backfill', {
            asset,
            error: err instanceof Error ? err.message : String(err),
        })
        return false
    }
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

    if (!backfillWorker) {
        try {
            backfillWorker = new Worker('price-history-backfill', processPriceHistoryBackfillJob, {
                connection: getConnectionOptions(),
                concurrency: 1,
            })
            backfillWorker.on('failed', (job, err) => {
                logger.error('[WORKER:price-history-backfill] Job failed', {
                    jobId: job?.id,
                    asset: job?.data?.asset,
                    error: err.message,
                })
            })
            logger.info('[WORKER:price-history-backfill] Worker started')
        } catch {
            logger.warn('[WORKER:price-history-backfill] Failed to start — Redis unavailable')
        }
    }
}

export async function stopPriceHistoryWorkers(): Promise<void> {
    await snapshotWorker?.close()
    await pruneWorker?.close()
    await backfillWorker?.close()
    snapshotWorker = null
    pruneWorker = null
    backfillWorker = null
}
