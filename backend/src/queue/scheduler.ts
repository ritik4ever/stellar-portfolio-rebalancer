import { randomUUID } from 'node:crypto'
import { getPortfolioCheckQueue, getAnalyticsSnapshotQueue, getAnalyticsCompactionQueue, getIdempotencyCleanupQueue } from './queues.js'
import { logger } from '../utils/logger.js'
import { setPortfolioCheckSchedulerRegistered } from './workers/portfolioCheckWorker.js'
import { setAnalyticsSnapshotSchedulerRegistered } from './workers/analyticsSnapshotWorker.js'
import { setAnalyticsCompactionSchedulerRegistered } from './workers/analyticsCompactionWorker.js'
import { setIdempotencyCleanupSchedulerRegistered } from './workers/idempotencyCleanupWorker.js'
import { notificationService } from '../services/notificationService.js'

const PORTFOLIO_CHECK_CRON = '*/30 * * * *'    // every 30 minutes
const ANALYTICS_SNAPSHOT_CRON = '0 * * * *'    // every 60 minutes (top of hour)
const ANALYTICS_COMPACTION_CRON = '0 2 * * 0'  // every Sunday at 02:00 UTC
const IDEMPOTENCY_CLEANUP_CRON = '15 * * * *'  // every 60 minutes (quarter past the hour)

function generateSchedulerCorrelationId(prefix: string): string {
    return `${prefix}-${randomUUID().slice(0, 8)}`
}

/**
 * Registers repeatable (recurring) BullMQ jobs.
 * Safe to call multiple times – BullMQ deduplicates by jobId.
 */
export async function startQueueScheduler(): Promise<void> {
    const portfolioCheckQueue = getPortfolioCheckQueue()
    const analyticsSnapshotQueue = getAnalyticsSnapshotQueue()
    const analyticsCompactionQueue = getAnalyticsCompactionQueue()
    const idempotencyCleanupQueue = getIdempotencyCleanupQueue()

    if (!portfolioCheckQueue || !analyticsSnapshotQueue || !analyticsCompactionQueue || !idempotencyCleanupQueue) {
        logger.warn('[SCHEDULER] Redis unavailable – scheduler not started')
        return
    }

    // ── Portfolio check (every 30 min) ──────────────────────────────────────
    await portfolioCheckQueue.add(
        'scheduled-portfolio-check',
        { triggeredBy: 'scheduler', correlationId: generateSchedulerCorrelationId('scheduled') },
        {
            repeat: { pattern: PORTFOLIO_CHECK_CRON },
            jobId: 'repeatable-portfolio-check',
        }
    )

    // ── Immediate startup check ──────────────────────────────────────────────
    await portfolioCheckQueue.add(
        'startup-portfolio-check',
        { triggeredBy: 'startup' as 'scheduler' | 'manual' | 'startup', correlationId: generateSchedulerCorrelationId('startup') },
        { priority: 1 }
    )

    // ── Analytics snapshot (every 60 min) ───────────────────────────────────
    await analyticsSnapshotQueue.add(
        'scheduled-analytics-snapshot',
        { triggeredBy: 'scheduler', correlationId: generateSchedulerCorrelationId('scheduled') },
        {
            repeat: { pattern: ANALYTICS_SNAPSHOT_CRON },
            jobId: 'repeatable-analytics-snapshot',
        }
    )

    // ── Immediate analytics snapshot on startup ──────────────────────────────
    await analyticsSnapshotQueue.add(
        'startup-analytics-snapshot',
        { triggeredBy: 'startup' as 'scheduler' | 'manual' | 'startup', correlationId: generateSchedulerCorrelationId('startup') },
        { priority: 1 }
    )

    // ── Analytics compaction (every Sunday at 02:00 UTC) ──────────────────────
    await analyticsCompactionQueue.add(
        'scheduled-analytics-compaction',
        { triggeredBy: 'scheduler', correlationId: generateSchedulerCorrelationId('scheduled') },
        {
            repeat: { pattern: ANALYTICS_COMPACTION_CRON },
            jobId: 'repeatable-analytics-compaction',
        }
    )

    // ── Idempotency cleanup (every 60 min) ──────────────────────────────────
    await idempotencyCleanupQueue.add(
        'scheduled-idempotency-cleanup',
        { triggeredBy: 'scheduler', correlationId: generateSchedulerCorrelationId('scheduled') },
        {
            repeat: { pattern: IDEMPOTENCY_CLEANUP_CRON },
            jobId: 'repeatable-idempotency-cleanup',
        }
    )

    // ── Immediate cleanup on startup ─────────────────────────────────────────
    await idempotencyCleanupQueue.add(
        'startup-idempotency-cleanup',
        { triggeredBy: 'startup' as 'scheduler' | 'manual' | 'startup', correlationId: generateSchedulerCorrelationId('startup') },
        { priority: 1 }
    )

    setPortfolioCheckSchedulerRegistered(true)
    setAnalyticsSnapshotSchedulerRegistered(true)
    setAnalyticsCompactionSchedulerRegistered(true)
    setIdempotencyCleanupSchedulerRegistered(true)

    logger.info('[SCHEDULER] Repeatable jobs registered', {
        portfolioCheck: PORTFOLIO_CHECK_CRON,
        analyticsSnapshot: ANALYTICS_SNAPSHOT_CRON,
        analyticsCompaction: ANALYTICS_COMPACTION_CRON,
        idempotencyCleanup: IDEMPOTENCY_CLEANUP_CRON,
    })

    // Schedule daily digest at 08:00 local time
    const scheduleDaily = () => {
        const now = new Date()
        const next = new Date(now)
        next.setHours(8, 0, 0, 0)
        if (next <= now) next.setDate(next.getDate() + 1)
        const ms = next.getTime() - now.getTime()
        setTimeout(async () => {
            try { await notificationService.processDigests('daily') } catch (e) { logger.error('Daily digest failed', { error: e instanceof Error ? e.message : String(e) }) }
            setInterval(async () => { try { await notificationService.processDigests('daily') } catch (e) { logger.error('Daily digest failed', { error: e instanceof Error ? e.message : String(e) }) } }, 24 * 60 * 60 * 1000)
        }, ms)
    }

    // Schedule weekly digest on Monday at 09:00 local time
    const scheduleWeekly = () => {
        const now = new Date()
        const next = new Date(now)
        next.setHours(9, 0, 0, 0)
        // set to next Monday
        const day = next.getDay()
        const daysUntilMonday = ((1 - day) + 7) % 7 || 7
        next.setDate(next.getDate() + daysUntilMonday)
        if (next <= now) next.setDate(next.getDate() + 7)
        const ms = next.getTime() - now.getTime()
        setTimeout(async () => {
            try { await notificationService.processDigests('weekly') } catch (e) { logger.error('Weekly digest failed', { error: e instanceof Error ? e.message : String(e) }) }
            setInterval(async () => { try { await notificationService.processDigests('weekly') } catch (e) { logger.error('Weekly digest failed', { error: e instanceof Error ? e.message : String(e) }) } }, 7 * 24 * 60 * 60 * 1000)
        }, ms)
    }

    try {
        scheduleDaily()
        scheduleWeekly()
        logger.info('[SCHEDULER] Digest timers scheduled (daily, weekly)')
    } catch (e) {
        logger.error('Failed to schedule digest timers', { error: e instanceof Error ? e.message : String(e) })
    }
}

/**
 * Removes repeatable jobs (called during graceful shutdown or tests).
 */
export async function stopQueueScheduler(): Promise<void> {
    const portfolioCheckQueue = getPortfolioCheckQueue()
    const analyticsSnapshotQueue = getAnalyticsSnapshotQueue()
    const analyticsCompactionQueue = getAnalyticsCompactionQueue()
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

    if (analyticsCompactionQueue) {
        const repeatableJobs = await analyticsCompactionQueue.getRepeatableJobs()
        for (const job of repeatableJobs) {
            await analyticsCompactionQueue.removeRepeatableByKey(job.key)
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
    setAnalyticsCompactionSchedulerRegistered(false)
    setIdempotencyCleanupSchedulerRegistered(false)

    logger.info('[SCHEDULER] Repeatable jobs removed')
}
