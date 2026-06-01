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
    queues: Record<QueueMetricName, QueueStats>
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

export const QUEUE_METRIC_NAMES = [
    QUEUE_NAMES.PORTFOLIO_CHECK,
    QUEUE_NAMES.REBALANCE,
    QUEUE_NAMES.ANALYTICS_SNAPSHOT,
] as const

export const QUEUE_METRIC_STATES = ['waiting', 'active', 'completed', 'failed', 'delayed'] as const satisfies readonly (keyof QueueStats)[]

export type QueueMetricName = typeof QUEUE_METRIC_NAMES[number]
export type QueueMetricState = typeof QUEUE_METRIC_STATES[number]

const emptyStats = (): QueueStats => ({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 })

async function statsFor(queue: Queue<any> | null, queueName: QueueMetricName): Promise<QueueStats> {
    if (!queue) {
        logger.warn('[queueMetrics] Queue unavailable while collecting metrics', { queue: queueName })
        return emptyStats()
    }
    try {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
            queue.getWaitingCount(),
            queue.getActiveCount(),
            queue.getCompletedCount(),
            queue.getFailedCount(),
            queue.getDelayedCount(),
        ])
        return { waiting, active, completed, failed, delayed }
    } catch (err) {
        logger.warn('[queueMetrics] Failed to collect queue metrics', { queue: queueName, error: String(err) })
        return emptyStats()
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
                [QUEUE_NAMES.PORTFOLIO_CHECK]: emptyStats(),
                [QUEUE_NAMES.REBALANCE]: emptyStats(),
                [QUEUE_NAMES.ANALYTICS_SNAPSHOT]: emptyStats(),
            },
        }
    }

    const [portfolioCheckStats, rebalanceStats, analyticsStats] = await Promise.all([
        statsFor(getPortfolioCheckQueue(), QUEUE_NAMES.PORTFOLIO_CHECK),
        statsFor(getRebalanceQueue(), QUEUE_NAMES.REBALANCE),
        statsFor(getAnalyticsSnapshotQueue(), QUEUE_NAMES.ANALYTICS_SNAPSHOT),
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
                    failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : new Date(job.timestamp).toISOString(),
                    error: job.stacktrace?.[0] ?? job.returnvalue ?? 'Unknown error',
                    attemptsMade: job.attemptsMade ?? 0,
                    data: (job.data !== null && typeof job.data === 'object' && !Array.isArray(job.data))
                        ? (job.data as Record<string, unknown>)
                        : { value: job.data }
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
