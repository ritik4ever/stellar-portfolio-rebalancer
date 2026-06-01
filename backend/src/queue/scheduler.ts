import { randomUUID } from 'node:crypto'
import { Redis } from 'ioredis'
import { getPortfolioCheckQueue, getAnalyticsSnapshotQueue, getIdempotencyCleanupQueue } from './queues.js'
import type { MissedScheduledJobRecovery } from './queues.js'
import { REDIS_URL } from './connection.js'
import { logger } from '../utils/logger.js'
import { setPortfolioCheckSchedulerRegistered } from './workers/portfolioCheckWorker.js'
import { setAnalyticsSnapshotSchedulerRegistered } from './workers/analyticsSnapshotWorker.js'
import { setIdempotencyCleanupSchedulerRegistered } from './workers/idempotencyCleanupWorker.js'
import {
    decideMissedJobRecovery,
    SCHEDULED_TASK_RECOVERY_CONFIGS,
    type MissedJobRecoveryDecision,
} from './schedulerRecovery.js'

const PORTFOLIO_CHECK_CRON = '*/30 * * * *'    // every 30 minutes
const ANALYTICS_SNAPSHOT_CRON = '0 * * * *'    // every 60 minutes (top of hour)
const IDEMPOTENCY_CLEANUP_CRON = '15 * * * *'  // every 60 minutes (quarter past the hour)
const SCHEDULER_LAST_SEEN_KEY = 'stellar-portfolio:scheduler:last-seen-at'
const SCHEDULER_HEARTBEAT_INTERVAL_MS = 60_000

let schedulerMetadataClient: Redis | null = null
let schedulerHeartbeat: NodeJS.Timeout | null = null

function generateSchedulerCorrelationId(prefix: string): string {
    return `${prefix}-${randomUUID().slice(0, 8)}`
}

function createRecoveryPayload(decision: MissedJobRecoveryDecision): MissedScheduledJobRecovery {
    return {
        action: decision.action,
        missedRuns: decision.missedRuns,
        lastSchedulerSeenAt: decision.lastSchedulerSeenAt ?? '',
        recoveredAt: decision.recoveredAt,
        reason: decision.reason,
    }
}

function recoveryJobId(decision: MissedJobRecoveryDecision): string {
    const lastSeen = decision.lastSchedulerSeenAt ? Date.parse(decision.lastSchedulerSeenAt) : 0
    return `scheduler-recovery-${decision.taskName}-${lastSeen}-${decision.missedRuns}`
}

function getSchedulerMetadataClient(): Redis {
    if (!schedulerMetadataClient) {
        schedulerMetadataClient = new Redis(REDIS_URL, {
            lazyConnect: true,
            connectTimeout: 3000,
            maxRetriesPerRequest: 1,
            enableReadyCheck: false,
            retryStrategy: () => null,
        })
        schedulerMetadataClient.on('error', () => {})
    }

    return schedulerMetadataClient
}

async function readLastSchedulerSeenAt(): Promise<string | null> {
    try {
        const client = getSchedulerMetadataClient()
        if (client.status === 'wait' || client.status === 'end') {
            await client.connect()
        }
        return await client.get(SCHEDULER_LAST_SEEN_KEY)
    } catch (err) {
        logger.warn('[SCHEDULER] Unable to read missed-job recovery checkpoint; startup jobs will run without downtime catch-up metadata', {
            error: err instanceof Error ? err.message : String(err),
        })
        return null
    }
}

async function writeSchedulerSeenAt(seenAt: Date): Promise<void> {
    try {
        const client = getSchedulerMetadataClient()
        if (client.status === 'wait' || client.status === 'end') {
            await client.connect()
        }
        await client.set(SCHEDULER_LAST_SEEN_KEY, seenAt.toISOString())
    } catch (err) {
        logger.warn('[SCHEDULER] Unable to write scheduler recovery checkpoint', {
            error: err instanceof Error ? err.message : String(err),
        })
    }
}

function startSchedulerHeartbeat(): void {
    if (schedulerHeartbeat) return

    schedulerHeartbeat = setInterval(() => {
        void writeSchedulerSeenAt(new Date())
    }, SCHEDULER_HEARTBEAT_INTERVAL_MS)
    schedulerHeartbeat.unref()
}

async function stopSchedulerHeartbeat(): Promise<void> {
    if (schedulerHeartbeat) {
        clearInterval(schedulerHeartbeat)
        schedulerHeartbeat = null
    }

    await writeSchedulerSeenAt(new Date())

    if (schedulerMetadataClient) {
        await schedulerMetadataClient.quit().catch(() => undefined)
        schedulerMetadataClient = null
    }
}

/**
 * Registers repeatable (recurring) BullMQ jobs.
 * Safe to call multiple times; BullMQ deduplicates by jobId.
 */
export async function startQueueScheduler(): Promise<void> {
    const portfolioCheckQueue = getPortfolioCheckQueue()
    const analyticsSnapshotQueue = getAnalyticsSnapshotQueue()
    const idempotencyCleanupQueue = getIdempotencyCleanupQueue()

    if (!portfolioCheckQueue || !analyticsSnapshotQueue || !idempotencyCleanupQueue) {
        logger.warn('[SCHEDULER] Redis unavailable - scheduler not started')
        return
    }

    const schedulerStartedAt = new Date()
    const lastSchedulerSeenAt = await readLastSchedulerSeenAt()
    const recoveryDecisions = decideMissedJobRecovery(
        SCHEDULED_TASK_RECOVERY_CONFIGS,
        lastSchedulerSeenAt,
        schedulerStartedAt,
    )
    const recoveredTasks = new Set(
        recoveryDecisions
            .filter((decision) => decision.action !== 'skip')
            .map((decision) => decision.taskName),
    )

    await portfolioCheckQueue.add(
        'scheduled-portfolio-check',
        { triggeredBy: 'scheduler', correlationId: generateSchedulerCorrelationId('scheduled') },
        {
            repeat: { pattern: PORTFOLIO_CHECK_CRON },
            jobId: 'repeatable-portfolio-check',
        }
    )

    const portfolioCheckRecovery = recoveryDecisions.find((decision) => decision.taskName === 'portfolio-check')
    if (portfolioCheckRecovery?.action !== 'skip') {
        await portfolioCheckQueue.add(
            'recovery-portfolio-check',
            {
                triggeredBy: 'recovery',
                correlationId: generateSchedulerCorrelationId('recovery'),
                recovery: createRecoveryPayload(portfolioCheckRecovery),
            },
            { priority: 1, jobId: recoveryJobId(portfolioCheckRecovery) }
        )
    } else {
        await portfolioCheckQueue.add(
            'startup-portfolio-check',
            { triggeredBy: 'startup', correlationId: generateSchedulerCorrelationId('startup') },
            { priority: 1 }
        )
    }

    await analyticsSnapshotQueue.add(
        'scheduled-analytics-snapshot',
        { triggeredBy: 'scheduler', correlationId: generateSchedulerCorrelationId('scheduled') },
        {
            repeat: { pattern: ANALYTICS_SNAPSHOT_CRON },
            jobId: 'repeatable-analytics-snapshot',
        }
    )

    const analyticsSnapshotRecovery = recoveryDecisions.find((decision) => decision.taskName === 'analytics-snapshot')
    if (analyticsSnapshotRecovery?.action !== 'skip') {
        await analyticsSnapshotQueue.add(
            'recovery-analytics-snapshot',
            {
                triggeredBy: 'recovery',
                correlationId: generateSchedulerCorrelationId('recovery'),
                recovery: createRecoveryPayload(analyticsSnapshotRecovery),
            },
            { priority: 1, jobId: recoveryJobId(analyticsSnapshotRecovery) }
        )
    } else {
        await analyticsSnapshotQueue.add(
            'startup-analytics-snapshot',
            { triggeredBy: 'startup', correlationId: generateSchedulerCorrelationId('startup') },
            { priority: 1 }
        )
    }

    await idempotencyCleanupQueue.add(
        'scheduled-idempotency-cleanup',
        { triggeredBy: 'scheduler', correlationId: generateSchedulerCorrelationId('scheduled') },
        {
            repeat: { pattern: IDEMPOTENCY_CLEANUP_CRON },
            jobId: 'repeatable-idempotency-cleanup',
        }
    )

    const idempotencyCleanupRecovery = recoveryDecisions.find((decision) => decision.taskName === 'idempotency-cleanup')
    if (idempotencyCleanupRecovery?.action !== 'skip') {
        await idempotencyCleanupQueue.add(
            'recovery-idempotency-cleanup',
            {
                triggeredBy: 'recovery',
                correlationId: generateSchedulerCorrelationId('recovery'),
                recovery: createRecoveryPayload(idempotencyCleanupRecovery),
            },
            { priority: 1, jobId: recoveryJobId(idempotencyCleanupRecovery) }
        )
    } else {
        await idempotencyCleanupQueue.add(
            'startup-idempotency-cleanup',
            { triggeredBy: 'startup', correlationId: generateSchedulerCorrelationId('startup') },
            { priority: 1 }
        )
    }

    setPortfolioCheckSchedulerRegistered(true)
    setAnalyticsSnapshotSchedulerRegistered(true)
    setIdempotencyCleanupSchedulerRegistered(true)

    logger.info('[SCHEDULER] Repeatable jobs registered', {
        portfolioCheck: PORTFOLIO_CHECK_CRON,
        analyticsSnapshot: ANALYTICS_SNAPSHOT_CRON,
        idempotencyCleanup: IDEMPOTENCY_CLEANUP_CRON,
        missedJobRecovery: recoveryDecisions,
        recoveredTasks: Array.from(recoveredTasks),
    })

    await writeSchedulerSeenAt(schedulerStartedAt)
    startSchedulerHeartbeat()
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

    await stopSchedulerHeartbeat()

    logger.info('[SCHEDULER] Repeatable jobs removed')
}
