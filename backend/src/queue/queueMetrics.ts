import { Queue, Job } from 'bullmq'
import { getPortfolioCheckQueue, getRebalanceQueue, getAnalyticsSnapshotQueue, QUEUE_NAMES } from './queues.js'
import { isRedisAvailable } from './connection.js'
import { logger } from '../utils/logger.js'

export interface QueueStats {
    waiting: number
    active: number
    completed: number
    failed: number
    delayed: number
}

export interface AllQueueMetrics {
    redisConnected: boolean
    queues: Record<string, QueueStats>
}

export interface FailedJobInfo {
    jobId: number | string
    queueName: string
    failedAt: string
    error: string
    attemptsMade: number
    data: Record<string, unknown>
}

export interface FailedJobsResult {
    totalFailed: number
    jobs: FailedJobInfo[]
    countsByQueue: Record<string, number>
}

const EMPTY_STATS: QueueStats = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }

async function statsFor(queue: Queue<any> | null): Promise<QueueStats> {
    if (!queue) return EMPTY_STATS
    try {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
            queue.getWaitingCount(),
            queue.getActiveCount(),
            queue.getCompletedCount(),
            queue.getFailedCount(),
            queue.getDelayedCount(),
        ])
        return { waiting, active, completed, failed, delayed }
    } catch {
        return EMPTY_STATS
    }
}

/**
 * Returns queue depth metrics for all three queues.
 */
export async function getQueueMetrics(): Promise<AllQueueMetrics> {
    const redisConnected = await isRedisAvailable()

    if (!redisConnected) {
        return {
            redisConnected: false,
            queues: {
                [QUEUE_NAMES.PORTFOLIO_CHECK]: EMPTY_STATS,
                [QUEUE_NAMES.REBALANCE]: EMPTY_STATS,
                [QUEUE_NAMES.ANALYTICS_SNAPSHOT]: EMPTY_STATS,
            },
        }
    }

    const [portfolioCheckStats, rebalanceStats, analyticsStats] = await Promise.all([
        statsFor(getPortfolioCheckQueue()),
        statsFor(getRebalanceQueue()),
        statsFor(getAnalyticsSnapshotQueue()),
    ])

    return {
        redisConnected: true,
        queues: {
            [QUEUE_NAMES.PORTFOLIO_CHECK]: portfolioCheckStats,
            [QUEUE_NAMES.REBALANCE]: rebalanceStats,
            [QUEUE_NAMES.ANALYTICS_SNAPSHOT]: analyticsStats,
        },
    }
}

/**
 * Get failed jobs from all queues for inspection.
 * Limits to most recent jobs for performance.
 */
export async function getFailedJobs(limit: number = 20): Promise<FailedJobsResult> {
    const redisConnected = await isRedisAvailable()

    if (!redisConnected) {
        return {
            totalFailed: 0,
            jobs: [],
            countsByQueue: {}
        }
    }

    const queues = [
        { queue: getPortfolioCheckQueue(), name: QUEUE_NAMES.PORTFOLIO_CHECK },
        { queue: getRebalanceQueue(), name: QUEUE_NAMES.REBALANCE },
        { queue: getAnalyticsSnapshotQueue(), name: QUEUE_NAMES.ANALYTICS_SNAPSHOT },
    ]

    const allFailedJobs: FailedJobInfo[] = []
    const countsByQueue: Record<string, number> = {}

    for (const { queue, name } of queues) {
        if (!queue) continue

        try {
            const failedJobs = await queue.getFailed(0, limit)
            countsByQueue[name] = failedJobs.length

            for (const job of failedJobs) {
                allFailedJobs.push({
                    jobId: job.id ?? 'unknown',
                    queueName: name,
                    failedAt: (job as any).failedAt?.toISOString() ?? (job as any).updatedAt?.toISOString() ?? (job as any).timestamp?.toString() ?? new Date().toISOString(),
                    error: job.stacktrace?.[0] ?? job.returnvalue ?? 'Unknown error',
                    attemptsMade: job.attemptsMade ?? 0,
                    data: job.data as Record<string, unknown>
                })
            }
        } catch (err) {
            logger.warn('[queueMetrics] Failed to get failed jobs from queue', { queue: name, error: String(err) })
            countsByQueue[name] = 0
        }
    }

    allFailedJobs.sort((a, b) => new Date(b.failedAt).getTime() - new Date(a.failedAt).getTime())
    const totalFailed = Object.values(countsByQueue).reduce((sum, count) => sum + count, 0)

    return {
        totalFailed,
        jobs: allFailedJobs.slice(0, limit),
        countsByQueue
    }
}
