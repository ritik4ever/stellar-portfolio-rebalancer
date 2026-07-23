import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIsRedisAvailable = vi.fn()
const mockLoggerWarn = vi.fn()
const queueNames = {
    PORTFOLIO_CHECK: 'portfolio-check',
    REBALANCE: 'rebalance',
    ANALYTICS_SNAPSHOT: 'analytics-snapshot',
}

const buildQueue = (name: string, counts: { waiting?: number; active?: number; completed?: number; failed?: number; delayed?: number }) => ({
    name,
    getJobCounts: vi.fn().mockResolvedValue({
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
    }),
})

const mockPortfolioCheckQueue = buildQueue('portfolio-check', { waiting: 1 })
const mockRebalanceQueue = buildQueue('rebalance', { active: 2, failed: 3 })
const mockAnalyticsSnapshotQueue = buildQueue('analytics-snapshot', { delayed: 4 })

vi.mock('../queue/connection.js', () => ({
    isRedisAvailable: mockIsRedisAvailable,
}))

vi.mock('../queue/queues.js', () => ({
    QUEUE_NAMES: queueNames,
    getPortfolioCheckQueue: vi.fn(() => mockPortfolioCheckQueue),
    getRebalanceQueue: vi.fn(() => mockRebalanceQueue),
    getAnalyticsSnapshotQueue: vi.fn(() => mockAnalyticsSnapshotQueue),
}))

vi.mock('../utils/logger.js', () => ({
    logger: {
        warn: mockLoggerWarn,
    },
}))

describe('queue metrics service', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockIsRedisAvailable.mockResolvedValue(true)
    })

    it('returns fixed queue stats for the monitored queues', async () => {
        const { getQueueMetrics } = await import('../queue/queueMetrics.js')

        const result = await getQueueMetrics()

        expect(result).toEqual({
            redisConnected: true,
            queues: {
                'portfolio-check': { waiting: 1, active: 0, completed: 0, failed: 0, delayed: 0 },
                rebalance: { waiting: 0, active: 2, completed: 0, failed: 3, delayed: 0 },
                'analytics-snapshot': { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 4 },
            },
        })
    })

    it('logs actionable warnings and exports zeroes when a queue count cannot be collected', async () => {
        mockRebalanceQueue.getJobCounts.mockRejectedValueOnce(new Error('redis read failed'))
        const { getQueueMetrics } = await import('../queue/queueMetrics.js')

        const result = await getQueueMetrics()

        expect(result.queues.rebalance).toEqual({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 })
        expect(mockLoggerWarn).toHaveBeenCalledWith(
            '[queueMetrics] Failed to get stats for queue rebalance',
            expect.objectContaining({ error: expect.any(Error) })
        )
    })

    it('returns fixed zeroed queues when Redis is unavailable', async () => {
        mockIsRedisAvailable.mockResolvedValue(false)
        const { getQueueMetrics } = await import('../queue/queueMetrics.js')

        const result = await getQueueMetrics()

        expect(result).toEqual({
            redisConnected: false,
            queues: {
                'portfolio-check': { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
                rebalance: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
                'analytics-snapshot': { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
            },
        })
    })
})
