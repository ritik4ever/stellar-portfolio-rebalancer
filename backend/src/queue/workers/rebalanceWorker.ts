import { Worker, Job } from 'bullmq'
import { getConnectionOptions } from '../connection.js'
import { StellarService } from '../../services/stellar.js'
import { rebalanceHistoryService } from '../../services/serviceContainer.js'
import { notificationService } from '../../services/notificationService.js'
import { rebalanceLockService } from '../../services/rebalanceLock.js'
import { logger } from '../../utils/logger.js'
import type { RebalanceJobData } from '../queues.js'

let worker: Worker | null = null

/**
 * Core processor: executes a single portfolio rebalance.
 * Extracted as a standalone function so tests can call it directly.
 */
export async function processRebalanceJob(
    job: Job<RebalanceJobData>
): Promise<void> {
    const { portfolioId, triggeredBy } = job.data

    logger.info('[WORKER:rebalance] Executing rebalance', {
        jobId: job.id,
        portfolioId,
        triggeredBy,
    })

    // Try to acquire the concurrency lock
    const lockAcquired = await rebalanceLockService.acquireLock(portfolioId)

    if (!lockAcquired) {
        logger.info('[WORKER:rebalance] Rebalance already in progress. Aborting.', { portfolioId })
        return // Gracefully skip execution
    }

    const stellarService = new StellarService()
    try {
        const portfolio = await stellarService.getPortfolio(portfolioId)
        const rebalanceResult = await stellarService.executeRebalance(portfolioId)

        // Record success
        await rebalanceHistoryService.recordRebalanceEvent({
            portfolioId,
            trigger: triggeredBy === 'auto' ? 'Automatic Rebalancing' : 'Manual Rebalancing',
            trades: rebalanceResult.trades ?? 0,
            gasUsed: rebalanceResult.gasUsed ?? '0 XLM',
            status: 'completed',
            isAutomatic: triggeredBy === 'auto',
        })

        // Send notification
        try {
            await notificationService.notify({
                userId: portfolio.userAddress,
                eventType: 'rebalance',
                title: 'Portfolio Rebalanced',
                message: `Your portfolio has been automatically rebalanced. ${rebalanceResult.trades ?? 0} trades executed with ${rebalanceResult.gasUsed ?? '0 XLM'} gas used.`,
                data: {
                    portfolioId,
                    trades: rebalanceResult.trades,
                    gasUsed: rebalanceResult.gasUsed,
                    trigger: triggeredBy,
                },
                timestamp: new Date().toISOString(),
            })
        } catch (notifyErr) {
            logger.error('[WORKER:rebalance] Notification failed (non-fatal)', {
                portfolioId,
                error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
            })
        }

        logger.info('[WORKER:rebalance] Rebalance completed', {
            portfolioId,
            trades: rebalanceResult.trades,
        })
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)

        // Record failure in audit trail
        try {
            await rebalanceHistoryService.recordRebalanceEvent({
                portfolioId,
                trigger: `Automatic Rebalancing (Failed – attempt ${job.attemptsMade + 1})`,
                trades: 0,
                gasUsed: '0 XLM',
                status: 'failed',
                isAutomatic: triggeredBy === 'auto',
                error: errorMessage,
            })
        } catch (histErr) {
            logger.error('[WORKER:rebalance] Failed to record failure event', { histErr })
        }

        logger.error('[WORKER:rebalance] Rebalance failed', {
            portfolioId,
            error: errorMessage,
            attemptsMade: job.attemptsMade,
        })

        // Re-throw so BullMQ can retry with backoff
        throw err
    } finally {
        // Always release the lock to prevent deadlocks
        await rebalanceLockService.releaseLock(portfolioId)
    }
}

/**
 * Starts the rebalance BullMQ worker (singleton).
 */
export function startRebalanceWorker(): Worker | null {
    if (worker) return worker

    try {
        worker = new Worker(
            'rebalance',
            processRebalanceJob,
            {
                connection: getConnectionOptions(),
                concurrency: 3, // up to 3 rebalances in parallel
            }
        )
    } catch (err) {
        logger.warn('[WORKER:rebalance] Failed to start – Redis may be unavailable', {
            error: err instanceof Error ? err.message : String(err),
        })
        return null
    }

    worker.on('completed', (job: Job) => {
        logger.info('[WORKER:rebalance] Job completed', {
            jobId: job.id,
            portfolioId: job.data.portfolioId,
        })
    })

    worker.on('failed', (job: Job | undefined, err: Error) => {
        logger.error('[WORKER:rebalance] Job failed', {
            jobId: job?.id,
            portfolioId: job?.data.portfolioId,
            error: err.message,
            attemptsMade: job?.attemptsMade,
        })
    })

    logger.info('[WORKER:rebalance] Worker started (concurrency=3)')
    return worker
}

export async function stopRebalanceWorker(): Promise<void> {
    if (worker) {
        await worker.close()
        worker = null
        logger.info('[WORKER:rebalance] Worker stopped')
    }
}
