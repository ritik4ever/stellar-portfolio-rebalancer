import { randomUUID } from 'node:crypto'
import { getPortfolioCheckQueue, getAutoRebalanceCheckQueue, getAnalyticsSnapshotQueue, getAnalyticsCompactionQueue, getIdempotencyCleanupQueue, getQueueByName, getPriceHistorySnapshotQueue, getPriceHistoryPruneQueue } from './queues.js'
import { logger } from '../utils/logger.js'
import { setPortfolioCheckSchedulerRegistered } from './workers/portfolioCheckWorker.js'
import { setAutoRebalanceSchedulerRegistered } from '../jobs/autoRebalance.js'
import { setAnalyticsSnapshotSchedulerRegistered } from './workers/analyticsSnapshotWorker.js'
import { setAnalyticsCompactionSchedulerRegistered } from './workers/analyticsCompactionWorker.js'
import { setIdempotencyCleanupSchedulerRegistered } from './workers/idempotencyCleanupWorker.js'
import { setUserAlertsSchedulerRegistered } from './workers/userAlertsWorker.js'
import { notificationService } from '../services/notificationService.js'
import { sendDigests } from '../notifications/digest.js'

const PORTFOLIO_CHECK_CRON = '*/30 * * * *'    // every 30 minutes
const AUTO_REBALANCE_CRON = '*/15 * * * *'    // every 15 minutes
const ANALYTICS_SNAPSHOT_CRON = '0 * * * *'    // every 60 minutes (top of hour)
const ANALYTICS_COMPACTION_CRON = '0 2 * * 0'  // every Sunday at 02:00 UTC
const IDEMPOTENCY_CLEANUP_CRON = '15 * * * *'  // every 60 minutes (quarter past the hour)
const PRICE_HISTORY_SNAPSHOT_CRON = '*/5 * * * *'  // every 5 minutes
const PRICE_HISTORY_PRUNE_CRON = '0 2 * * *'       // daily at 02:00
const USER_ALERTS_CRON = '*/5 * * * *';

// Job recovery configuration
interface JobRecoveryConfig {
    queueName: string;
    cronPattern: string;
    jobId: string;
    critical: boolean;
    maxMissedToReplay: number;
    recoveryWindowMs: number;
}

const RECOVERY_CONFIGS: JobRecoveryConfig[] = [
    {
        queueName: 'portfolio-check',
        cronPattern: PORTFOLIO_CHECK_CRON,
        jobId: 'repeatable-portfolio-check',
        critical: true,
        maxMissedToReplay: 2,
        recoveryWindowMs: 24 * 60 * 60 * 1000,
    },
    {
        queueName: 'auto-rebalance-check',
        cronPattern: AUTO_REBALANCE_CRON,
        jobId: 'repeatable-auto-rebalance',
        critical: true,
        maxMissedToReplay: 4,
        recoveryWindowMs: 24 * 60 * 60 * 1000,
    },
    {
        queueName: 'analytics-snapshot',
        cronPattern: ANALYTICS_SNAPSHOT_CRON,
        jobId: 'repeatable-analytics-snapshot',
        critical: true,
        maxMissedToReplay: 1,
        recoveryWindowMs: 24 * 60 * 60 * 1000,
    },
    {
        queueName: 'analytics-compaction',
        cronPattern: ANALYTICS_COMPACTION_CRON,
        jobId: 'repeatable-analytics-compaction',
        critical: false,
        maxMissedToReplay: 0,
        recoveryWindowMs: 7 * 24 * 60 * 60 * 1000,
    },
    {
        queueName: 'idempotency-cleanup',
        cronPattern: IDEMPOTENCY_CLEANUP_CRON,
        jobId: 'repeatable-idempotency-cleanup',
        critical: true,
        maxMissedToReplay: 1,
        recoveryWindowMs: 24 * 60 * 60 * 1000,
    },
    {
        queueName: 'user-alerts',
        cronPattern: USER_ALERTS_CRON,
        jobId: 'repeatable-user-alerts-check',
        critical: false,
        maxMissedToReplay: 0,
        recoveryWindowMs: 24 * 60 * 60 * 1000,
    }
]

function generateSchedulerCorrelationId(prefix: string): string {
    return `${prefix}-${randomUUID().slice(0, 8)}`
}

function calculateMissedExecutions(cronPattern: string, since: Date, now: Date): number {
    const intervalMs: Record<string, number> = {
        '*/5 * * * *': 5 * 60 * 1000,
        '*/30 * * * *': 30 * 60 * 1000,
        '*/15 * * * *': 15 * 60 * 1000,
        '0 * * * *': 60 * 60 * 1000,
        '15 * * * *': 60 * 60 * 1000,
        '0 2 * * *': 24 * 60 * 60 * 1000,
        '0 2 * * 0': 7 * 24 * 60 * 60 * 1000,
    }

    const interval = intervalMs[cronPattern] || 60 * 60 * 1000
    const elapsedMs = now.getTime() - since.getTime()
    return Math.floor(elapsedMs / interval)
}

async function recoverMissedJobs(): Promise<void> {
    const now = new Date()
    const recoveryResults: Array<{
        queueName: string;
        jobId: string;
        missedCount: number;
        action: 'replayed' | 'skipped' | 'none';
        reason?: string;
    }> = []

    for (const config of RECOVERY_CONFIGS) {
        try {
            const queue = getQueueByName(config.queueName)
            if (!queue) {
                logger.warn(`[RECOVERY] Queue not available for ${config.queueName}, skipping recovery`)
                continue
            }

            const repeatableJobs = await queue.getRepeatableJobs()
            const job = repeatableJobs.find(j => j.id === config.jobId)

            if (!job) {
                logger.info(`[RECOVERY] No repeatable job found for ${config.jobId}, skipping recovery`)
                continue
            }

            const lastExecution = job.next ? new Date(job.next) : now
            const missedCount = calculateMissedExecutions(config.cronPattern, lastExecution, now)

            if (missedCount <= 0) {
                recoveryResults.push({ queueName: config.queueName, jobId: config.jobId, missedCount: 0, action: 'none' })
                continue
            }

            if (!config.critical) {
                logger.info(`[RECOVERY] Skipped ${missedCount} missed executions for ${config.jobId} (non-critical job)`, { queueName: config.queueName, missedCount, reason: 'non-critical' })
                recoveryResults.push({ queueName: config.queueName, jobId: config.jobId, missedCount, action: 'skipped', reason: 'non-critical' })
                continue
            }

            if (missedCount > config.maxMissedToReplay) {
                logger.warn(`[RECOVERY] Too many missed executions (${missedCount}) for ${config.jobId}, skipping replay (max: ${config.maxMissedToReplay})`, { queueName: config.queueName, missedCount, maxReplay: config.maxMissedToReplay })
                recoveryResults.push({ queueName: config.queueName, jobId: config.jobId, missedCount, action: 'skipped', reason: 'exceeded max replay limit' })
                continue
            }

            const jobsToReplay = Math.min(missedCount, config.maxMissedToReplay)
            for (let i = 0; i < jobsToReplay; i++) {
                const jobName = config.jobId.replace('repeatable-', 'recovery-')
                await queue.add(jobName, { triggeredBy: 'recovery' as const, correlationId: generateSchedulerCorrelationId('recovery') }, { priority: 1 })
            }

            logger.info(`[RECOVERY] Replayed ${jobsToReplay} missed executions for ${config.jobId}`, { queueName: config.queueName, missedCount, replayed: jobsToReplay })
            recoveryResults.push({ queueName: config.queueName, jobId: config.jobId, missedCount, action: 'replayed' })

        } catch (error) {
            logger.error(`[RECOVERY] Failed to recover jobs for ${config.queueName}`, {
                error: error instanceof Error ? error.message : String(error),
                config,
            })
        }
    }

    const totalMissed = recoveryResults.reduce((sum, r) => sum + r.missedCount, 0)
    const totalReplayed = recoveryResults.filter(r => r.action === 'replayed').length
    const totalSkipped = recoveryResults.filter(r => r.action === 'skipped').length

    if (totalMissed > 0) {
        logger.warn(`[RECOVERY] Job recovery complete: ${totalMissed} missed executions detected, ${totalReplayed} replayed, ${totalSkipped} skipped`, { results: recoveryResults })
    } else {
        logger.info('[RECOVERY] No missed jobs detected, recovery not needed')
    }
}

/**
 * Registers repeatable (recurring) BullMQ jobs.
 * Safe to call multiple times – BullMQ deduplicates by jobId.
 */
export async function startQueueScheduler(): Promise<void> {
    const portfolioCheckQueue = getPortfolioCheckQueue()
    const autoRebalanceCheckQueue = getAutoRebalanceCheckQueue()
    const analyticsSnapshotQueue = getAnalyticsSnapshotQueue()
    const analyticsCompactionQueue = getAnalyticsCompactionQueue()
    const idempotencyCleanupQueue = getIdempotencyCleanupQueue()

    if (!portfolioCheckQueue || !autoRebalanceCheckQueue || !analyticsSnapshotQueue || !analyticsCompactionQueue || !idempotencyCleanupQueue) {
        logger.warn('[SCHEDULER] Redis unavailable – scheduler not started')
        return
    }

    await portfolioCheckQueue.add(
        'scheduled-portfolio-check',
        { triggeredBy: 'scheduler', correlationId: generateSchedulerCorrelationId('scheduled') },
        { repeat: { pattern: PORTFOLIO_CHECK_CRON }, jobId: 'repeatable-portfolio-check' }
    )

    await portfolioCheckQueue.add(
        'startup-portfolio-check',
        { triggeredBy: 'startup' as 'scheduler' | 'manual' | 'startup', correlationId: generateSchedulerCorrelationId('startup') },
        { priority: 1 }
    )

    await analyticsSnapshotQueue.add(
        'scheduled-analytics-snapshot',
        { triggeredBy: 'scheduler', correlationId: generateSchedulerCorrelationId('scheduled') },
        { repeat: { pattern: ANALYTICS_SNAPSHOT_CRON }, jobId: 'repeatable-analytics-snapshot' }
    )

    await analyticsSnapshotQueue.add(
        'startup-analytics-snapshot',
        { triggeredBy: 'startup' as 'scheduler' | 'manual' | 'startup', correlationId: generateSchedulerCorrelationId('startup') },
        { priority: 1 }
    )

    await analyticsCompactionQueue.add(
        'scheduled-analytics-compaction',
        { triggeredBy: 'scheduler', correlationId: generateSchedulerCorrelationId('scheduled') },
        { repeat: { pattern: ANALYTICS_COMPACTION_CRON }, jobId: 'repeatable-analytics-compaction' }
    )

    await idempotencyCleanupQueue.add(
        'scheduled-idempotency-cleanup',
        { triggeredBy: 'scheduler', correlationId: generateSchedulerCorrelationId('scheduled') },
        { repeat: { pattern: IDEMPOTENCY_CLEANUP_CRON }, jobId: 'repeatable-idempotency-cleanup' }
    )

    await idempotencyCleanupQueue.add(
        'startup-idempotency-cleanup',
        { triggeredBy: 'startup' as 'scheduler' | 'manual' | 'startup', correlationId: generateSchedulerCorrelationId('startup') },
        { priority: 1 }
    )

    await autoRebalanceCheckQueue.add(
        'scheduled-auto-rebalance',
        { triggeredBy: 'scheduler', correlationId: generateSchedulerCorrelationId('scheduled') },
        { repeat: { pattern: AUTO_REBALANCE_CRON }, jobId: 'repeatable-auto-rebalance' }
    )

    await autoRebalanceCheckQueue.add(
        'startup-auto-rebalance',
        { triggeredBy: 'startup' as 'scheduler' | 'manual' | 'startup' | 'recovery', correlationId: generateSchedulerCorrelationId('startup') },
        { priority: 1 }
    )

    setPortfolioCheckSchedulerRegistered(true)
    setAutoRebalanceSchedulerRegistered(true)
    setAnalyticsSnapshotSchedulerRegistered(true)
    setAnalyticsCompactionSchedulerRegistered(true)
    setIdempotencyCleanupSchedulerRegistered(true)

    // ── Price history snapshot (every 5 min) ────────────────────────────────
    const priceHistorySnapshotQueue = getPriceHistorySnapshotQueue()
    if (priceHistorySnapshotQueue) {
        await priceHistorySnapshotQueue.add(
            'scheduled-price-history-snapshot',
            { triggeredBy: 'scheduler' },
            { repeat: { pattern: PRICE_HISTORY_SNAPSHOT_CRON }, jobId: 'repeatable-price-history-snapshot' }
        )
    }

    // ── Price history prune (daily at 02:00) ────────────────────────────────
    const priceHistoryPruneQueue = getPriceHistoryPruneQueue()
    if (priceHistoryPruneQueue) {
        await priceHistoryPruneQueue.add(
            'scheduled-price-history-prune',
            { triggeredBy: 'scheduler' },
            { repeat: { pattern: PRICE_HISTORY_PRUNE_CRON }, jobId: 'repeatable-price-history-prune' }
        )
    }

    const userAlertsQueue = getQueueByName('user-alerts');
    if (userAlertsQueue) {
        await userAlertsQueue.add(
            'scheduled-user-alerts-check',
            { triggeredBy: 'scheduler', correlationId: generateSchedulerCorrelationId('alerts') },
            { repeat: { pattern: USER_ALERTS_CRON }, jobId: 'repeatable-user-alerts-check' }
        );
        setUserAlertsSchedulerRegistered(true);
    }

    logger.info('[SCHEDULER] Repeatable jobs registered', {
        portfolioCheck: PORTFOLIO_CHECK_CRON,
        autoRebalance: AUTO_REBALANCE_CRON,
        analyticsSnapshot: ANALYTICS_SNAPSHOT_CRON,
        analyticsCompaction: ANALYTICS_COMPACTION_CRON,
        idempotencyCleanup: IDEMPOTENCY_CLEANUP_CRON,
        priceHistorySnapshot: PRICE_HISTORY_SNAPSHOT_CRON,
        priceHistoryPrune: PRICE_HISTORY_PRUNE_CRON,
        userAlertsCheck: USER_ALERTS_CRON,
    })

    try {
        await recoverMissedJobs()
    } catch (error) {
        logger.error('[SCHEDULER] Job recovery failed', {
            error: error instanceof Error ? error.message : String(error),
        })
    }

    const scheduleDaily = () => {
        const now = new Date()
        const next = new Date(now)
        next.setHours(8, 0, 0, 0)
        if (next <= now) next.setDate(next.getDate() + 1)
        const ms = next.getTime() - now.getTime()
        setTimeout(async () => {
            try { await notificationService.processDigests('daily') } catch (e) { logger.error('Daily digest failed', { error: e instanceof Error ? e.message : String(e) }) }
            try { await sendDigests('daily') } catch (e) { logger.error('Daily portfolio digest failed', { error: e instanceof Error ? e.message : String(e) }) }
            setInterval(async () => {
                try { await notificationService.processDigests('daily') } catch (e) { logger.error('Daily digest failed', { error: e instanceof Error ? e.message : String(e) }) }
                try { await sendDigests('daily') } catch (e) { logger.error('Daily portfolio digest failed', { error: e instanceof Error ? e.message : String(e) }) }
            }, 24 * 60 * 60 * 1000)
        }, ms)
    }

    const scheduleWeekly = () => {
        const now = new Date()
        const next = new Date(now)
        next.setHours(9, 0, 0, 0)
        const day = next.getDay()
        const daysUntilMonday = ((1 - day) + 7) % 7 || 7
        next.setDate(next.getDate() + daysUntilMonday)
        if (next <= now) next.setDate(next.getDate() + 7)
        const ms = next.getTime() - now.getTime()
        setTimeout(async () => {
            try { await notificationService.processDigests('weekly') } catch (e) { logger.error('Weekly digest failed', { error: e instanceof Error ? e.message : String(e) }) }
            try { await sendDigests('weekly') } catch (e) { logger.error('Weekly portfolio digest failed', { error: e instanceof Error ? e.message : String(e) }) }
            setInterval(async () => {
                try { await notificationService.processDigests('weekly') } catch (e) { logger.error('Weekly digest failed', { error: e instanceof Error ? e.message : String(e) }) }
                try { await sendDigests('weekly') } catch (e) { logger.error('Weekly portfolio digest failed', { error: e instanceof Error ? e.message : String(e) }) }
            }, 7 * 24 * 60 * 60 * 1000)
        }, ms)
    }

    const scheduleMonthly = () => {
        const now = new Date()
        const next = new Date(now)
        next.setHours(10, 0, 0, 0)
        next.setDate(1)
        if (next <= now) next.setMonth(next.getMonth() + 1)
        const ms = next.getTime() - now.getTime()
        setTimeout(async () => {
            try { await sendDigests('monthly') } catch (e) { logger.error('Monthly portfolio digest failed', { error: e instanceof Error ? e.message : String(e) }) }
            setInterval(async () => {
                try { await sendDigests('monthly') } catch (e) { logger.error('Monthly portfolio digest failed', { error: e instanceof Error ? e.message : String(e) }) }
            }, 30 * 24 * 60 * 60 * 1000)
        }, ms)
    }

    try {
        scheduleDaily()
        scheduleWeekly()
        scheduleMonthly()
        logger.info('[SCHEDULER] Digest timers scheduled (daily, weekly, monthly)')
    } catch (e) {
        logger.error('Failed to schedule digest timers', { error: e instanceof Error ? e.message : String(e) })
    }
}

/**
 * Removes repeatable jobs (called during graceful shutdown or tests).
 */
export async function stopQueueScheduler(): Promise<void> {
    const portfolioCheckQueue = getPortfolioCheckQueue()
    const autoRebalanceCheckQueue = getAutoRebalanceCheckQueue()
    const analyticsSnapshotQueue = getAnalyticsSnapshotQueue()
    const analyticsCompactionQueue = getAnalyticsCompactionQueue()
    const idempotencyCleanupQueue = getIdempotencyCleanupQueue()
    const userAlertsQueue = getQueueByName('user-alerts')


        if (queue) {
            const repeatableJobs = await queue.getRepeatableJobs()
            for (const job of repeatableJobs) {
                await queue.removeRepeatableByKey(job.key)
            }
        }
    }

    setPortfolioCheckSchedulerRegistered(false)
    setAutoRebalanceSchedulerRegistered(false)
    setAnalyticsSnapshotSchedulerRegistered(false)
    setAnalyticsCompactionSchedulerRegistered(false)
    setIdempotencyCleanupSchedulerRegistered(false)
    setUserAlertsSchedulerRegistered(false)

    logger.info('[SCHEDULER] Repeatable jobs removed')
}