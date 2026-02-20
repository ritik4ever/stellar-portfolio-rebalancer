import { Queue } from 'bullmq'
import { getPortfolioCheckQueue, getRebalanceQueue, getAnalyticsSnapshotQueue, QUEUE_NAMES } from './queues.js'
import { isRedisAvailable } from './connection.js'

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
