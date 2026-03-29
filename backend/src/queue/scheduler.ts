import { getPortfolioCheckQueue, getAnalyticsSnapshotQueue, getIdempotencyCleanupQueue } from './queues.js'
import { logger } from '../utils/logger.js'
import { setPortfolioCheckSchedulerRegistered } from './workers/portfolioCheckWorker.js'
import { setAnalyticsSnapshotSchedulerRegistered } from './workers/analyticsSnapshotWorker.js'
import { setIdempotencyCleanupSchedulerRegistered } from './workers/idempotencyCleanupWorker.js'

const PORTFOLIO_CHECK_CRON = '*/30 * * * *'    // every 30 minutes
const ANALYTICS_SNAPSHOT_CRON = '0 * * * *'    // every 60 minutes (top of hour)
const IDEMPOTENCY_CLEANUP_CRON = '15 * * * *'  // every 60 minutes (quarter past the hour)

/**
 * Registers repeatable (recurring) BullMQ jobs.
 * Safe to call multiple times – BullMQ deduplicates by jobId.
 */
export async function startQueueScheduler(): Promise<void> {
    const portfolioCheckQueue = getPortfolioCheckQueue()
    const analyticsSnapshotQueue = getAnalyticsSnapshotQueue()
    const idempotencyCleanupQueue = getIdempotencyCleanupQueue()

    if (!portfolioCheckQueue || !analyticsSnapshotQueue || !idempotencyCleanupQueue) {
        logger.warn('[SCHEDULER] Redis unavailable – scheduler not started')
        return
    }

    // ── Portfolio check (every 30 min) ──────────────────────────────────────
    await portfolioCheckQueue.add(
        'scheduled-portfolio-check',
        { triggeredBy: 'scheduler' },
        {
            repeat: { pattern: PORTFOLIO_CHECK_CRON },
            jobId: 'repeatable-portfolio-check',
        }
    )

    // ── Immediate startup check ──────────────────────────────────────────────
    await portfolioCheckQueue.add(
        'startup-portfolio-check',
        { triggeredBy: 'startup' as 'scheduler' | 'manual' | 'startup' },
        { priority: 1 }
    )

    // ── Analytics snapshot (every 60 min) ───────────────────────────────────
    await analyticsSnapshotQueue.add(
        'scheduled-analytics-snapshot',
        { triggeredBy: 'scheduler' },
        {
            repeat: { pattern: ANALYTICS_SNAPSHOT_CRON },
            jobId: 'repeatable-analytics-snapshot',
        }
    )

    // ── Immediate analytics snapshot on startup ──────────────────────────────
    await analyticsSnapshotQueue.add(
        'startup-analytics-snapshot',
        { triggeredBy: 'startup' as 'scheduler' | 'manual' | 'startup' },
        { priority: 1 }
    )

    // ── Idempotency cleanup (every 60 min) ──────────────────────────────────
    await idempotencyCleanupQueue.add(
        'scheduled-idempotency-cleanup',
        { triggeredBy: 'scheduler' },
        {
            repeat: { pattern: IDEMPOTENCY_CLEANUP_CRON },
            jobId: 'repeatable-idempotency-cleanup',
        }
    )

    // ── Immediate cleanup on startup ─────────────────────────────────────────
    await idempotencyCleanupQueue.add(
        'startup-idempotency-cleanup',
        { triggeredBy: 'startup' as 'scheduler' | 'manual' | 'startup' },
        { priority: 1 }
    )

    setPortfolioCheckSchedulerRegistered(true)
    setAnalyticsSnapshotSchedulerRegistered(true)
    setIdempotencyCleanupSchedulerRegistered(true)

    logger.info('[SCHEDULER] Repeatable jobs registered', {
        portfolioCheck: PORTFOLIO_CHECK_CRON,
        analyticsSnapshot: ANALYTICS_SNAPSHOT_CRON,
        idempotencyCleanup: IDEMPOTENCY_CLEANUP_CRON,
    })
}

/**
 * Removes repeatable jobs (called during graceful shutdown or tests).
 */
export async function stopQueueScheduler(): Promise<void> {
    const portfolioCheckQueue = getPortfolioCheckQueue()
    const analyticsSnapshotQueue = getAnalyticsSnapshotQueue()
    const idempotencyCleanupQueue = getIdempotencyCleanupQueue()

    if (portfolioCheckQueue) {
        const repeatableJobs = await portfolioCheckQueue.getRepeatableJobs()
        for (const job of repeatableJobs) {
            await portfolioCheckQueue.removeRepeatableByKey(job.key)
        }
    }

    if (analyticsSnapshotQueue) {
        const repeatableJobs = await analyticsSnapshotQueue.getRepeatableJobs()
        for (const job of repeatableJobs) {
            await analyticsSnapshotQueue.removeRepeatableByKey(job.key)
        }
    }

    if (idempotencyCleanupQueue) {
        const repeatableJobs = await idempotencyCleanupQueue.getRepeatableJobs()
        for (const job of repeatableJobs) {
            await idempotencyCleanupQueue.removeRepeatableByKey(job.key)
        }
    }

    setPortfolioCheckSchedulerRegistered(false)
    setAnalyticsSnapshotSchedulerRegistered(false)
    setIdempotencyCleanupSchedulerRegistered(false)

    logger.info('[SCHEDULER] Repeatable jobs removed')
}
