import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetReadiness = vi.fn()
const mockIsRedisAvailable = vi.fn()
const mockGetPortfolioCheckQueue = vi.fn()
const mockGetRebalanceQueue = vi.fn()
const mockGetAnalyticsSnapshotQueue = vi.fn()
const mockGetPortfolioCheckWorkerStatus = vi.fn()
const mockGetRebalanceWorkerStatus = vi.fn()
const mockGetAnalyticsSnapshotWorkerStatus = vi.fn()
const mockGetIndexerStatus = vi.fn()
const mockGetAutoRebalancerStatus = vi.fn()

vi.mock('../services/databaseService.js', () => ({
    databaseService: {
        getReadiness: mockGetReadiness
    }
}))

vi.mock('../queue/connection.js', () => ({
    isRedisAvailable: mockIsRedisAvailable
}))

vi.mock('../queue/queues.js', () => ({
    QUEUE_NAMES: {
        PORTFOLIO_CHECK: 'portfolio-check',
        REBALANCE: 'rebalance',
        ANALYTICS_SNAPSHOT: 'analytics-snapshot',
    },
    getPortfolioCheckQueue: mockGetPortfolioCheckQueue,
    getRebalanceQueue: mockGetRebalanceQueue,
    getAnalyticsSnapshotQueue: mockGetAnalyticsSnapshotQueue,
}))

vi.mock('../queue/workers/portfolioCheckWorker.js', () => ({
    getPortfolioCheckWorkerStatus: mockGetPortfolioCheckWorkerStatus
}))

vi.mock('../queue/workers/rebalanceWorker.js', () => ({
    getRebalanceWorkerStatus: mockGetRebalanceWorkerStatus
}))

vi.mock('../queue/workers/analyticsSnapshotWorker.js', () => ({
    getAnalyticsSnapshotWorkerStatus: mockGetAnalyticsSnapshotWorkerStatus
}))

vi.mock('../services/contractEventIndexer.js', () => ({
    contractEventIndexerService: {
        getStatus: mockGetIndexerStatus
    }
}))

vi.mock('../services/runtimeServices.js', () => ({
    autoRebalancer: {
        getStatus: mockGetAutoRebalancerStatus
    }
}))

function readyQueue() {
    return {
        waitUntilReady: vi.fn().mockResolvedValue(undefined)
    }
}

function readyWorker(name: string) {
    return {
        name,
        concurrency: 1,
        started: true,
        ready: true,
        schedulerRegistered: false,
    }
}

describe('buildReadinessReport', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        process.env.NODE_ENV = 'test'
        delete process.env.ENABLE_AUTO_REBALANCER

        mockGetReadiness.mockReturnValue({
            ready: true,
            databasePath: '/tmp/test.db'
        })
        mockIsRedisAvailable.mockResolvedValue(true)
        mockGetPortfolioCheckQueue.mockReturnValue(readyQueue())
        mockGetRebalanceQueue.mockReturnValue(readyQueue())
        mockGetAnalyticsSnapshotQueue.mockReturnValue(readyQueue())
        mockGetPortfolioCheckWorkerStatus.mockReturnValue(readyWorker('portfolio-check'))
        mockGetRebalanceWorkerStatus.mockReturnValue(readyWorker('rebalance'))
        mockGetAnalyticsSnapshotWorkerStatus.mockReturnValue(readyWorker('analytics-snapshot'))
        mockGetIndexerStatus.mockReturnValue({
            enabled: false,
            running: false,
            pollIntervalMs: 15000,
            lastIngestedCount: 0
        })
        mockGetAutoRebalancerStatus.mockReturnValue({
            isRunning: false,
            initialized: false,
            backend: 'bullmq'
        })
    })

    it('returns ready when all required subsystems are ready', async () => {
        const { buildReadinessReport } = await import('../monitoring/readiness.js')

        const report = await buildReadinessReport()

        expect(report.status).toBe('ready')
        expect(report.checks.database.status).toBe('ready')
        expect(report.checks.queue.status).toBe('ready')
        expect(report.checks.workers.status).toBe('ready')
        expect(report.checks.contractEventIndexer.status).toBe('disabled')
        expect(report.checks.autoRebalancer.status).toBe('disabled')
    })

    it('returns not_ready when an enabled auto-rebalancer is not initialized', async () => {
        process.env.ENABLE_AUTO_REBALANCER = 'true'
        mockGetAutoRebalancerStatus.mockReturnValue({
            isRunning: true,
            initialized: false,
            backend: 'bullmq',
            lastInitializationError: 'Redis unavailable'
        })

        const { buildReadinessReport } = await import('../monitoring/readiness.js')
        const report = await buildReadinessReport()

        expect(report.status).toBe('not_ready')
        expect(report.checks.autoRebalancer.status).toBe('not_ready')
    })
})
