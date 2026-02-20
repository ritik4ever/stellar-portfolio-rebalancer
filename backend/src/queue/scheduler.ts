import { getPortfolioCheckQueue, getAnalyticsSnapshotQueue } from './queues.js'
import { logger } from '../utils/logger.js'

const PORTFOLIO_CHECK_CRON = '*/30 * * * *'    // every 30 minutes
const ANALYTICS_SNAPSHOT_CRON = '0 * * * *'    // every 60 minutes (top of hour)

/**
 * Registers repeatable (recurring) BullMQ jobs.
 * Safe to call multiple times – BullMQ deduplicates by jobId.
 */
export async function startQueueScheduler(): Promise<void> {
    const portfolioCheckQueue = getPortfolioCheckQueue()
    const analyticsSnapshotQueue = getAnalyticsSnapshotQueue()

    if (!portfolioCheckQueue || !analyticsSnapshotQueue) {
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

    logger.info('[SCHEDULER] Repeatable jobs registered', {
        portfolioCheck: PORTFOLIO_CHECK_CRON,
        analyticsSnapshot: ANALYTICS_SNAPSHOT_CRON,
    })
}

/**
 * Removes repeatable jobs (called during graceful shutdown or tests).
 */
export async function stopQueueScheduler(): Promise<void> {
    const portfolioCheckQueue = getPortfolioCheckQueue()
    const analyticsSnapshotQueue = getAnalyticsSnapshotQueue()

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

    logger.info('[SCHEDULER] Repeatable jobs removed')
}
