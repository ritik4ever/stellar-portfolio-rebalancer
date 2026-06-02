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
    beforeEach(async () => {
        vi.clearAllMocks()
        process.env.NODE_ENV = 'test'
        delete process.env.ENABLE_AUTO_REBALANCER
        delete process.env.READINESS_CACHE_TTL_MS

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
            lastIngestedCount: 0,
            expectedEventSchemaVersion: 1,
            contractEventSchemaOk: true
        })
        mockGetAutoRebalancerStatus.mockReturnValue({
            isRunning: false,
            initialized: false,
            backend: 'bullmq'
        })

        const { clearReadinessCache } = await import('../monitoring/readiness.js')
        clearReadinessCache()
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

    it('returns not_ready when indexer is enabled and contract event schema check failed', async () => {
        mockGetIndexerStatus.mockReturnValue({
            enabled: true,
            running: false,
            pollIntervalMs: 15000,
            lastIngestedCount: 0,
            expectedEventSchemaVersion: 1,
            contractEventSchemaOk: false,
            lastError: 'CONTRACT_EVENT_SCHEMA_VERSION mismatch'
        })

        const { buildReadinessReport } = await import('../monitoring/readiness.js')
        const report = await buildReadinessReport()

        expect(report.status).toBe('not_ready')
        expect(report.checks.contractEventIndexer.status).toBe('not_ready')
        expect(report.checks.contractEventIndexer.message).toContain('mismatch')
    })

    it('caches readiness report within TTL and serves from cache', async () => {
        const { buildReadinessReport, setReadinessCacheTtl, clearReadinessCache } = await import('../monitoring/readiness.js')
        clearReadinessCache()
        setReadinessCacheTtl(5000)

        mockGetReadiness.mockClear()
        mockIsRedisAvailable.mockClear()

        const report1 = await buildReadinessReport()
        expect(report1.status).toBe('ready')
        expect(mockGetReadiness).toHaveBeenCalledTimes(1)

        mockGetReadiness.mockReturnValue({
            ready: false,
            databasePath: '/tmp/test.db',
            error: 'simulated failure'
        })

        const report2 = await buildReadinessReport()
        expect(report2.status).toBe('ready')
        expect(report2.timestamp).toBe(report1.timestamp)
        expect(mockGetReadiness).toHaveBeenCalledTimes(1)
    })

    it('skips cache when TTL is set to 0', async () => {
        const { buildReadinessReport, setReadinessCacheTtl, clearReadinessCache } = await import('../monitoring/readiness.js')
        clearReadinessCache()
        setReadinessCacheTtl(0)

        mockGetReadiness.mockClear()
        mockIsRedisAvailable.mockClear()

        await buildReadinessReport()
        expect(mockGetReadiness).toHaveBeenCalledTimes(1)

        mockGetReadiness.mockReturnValue({
            ready: false,
            databasePath: '/tmp/test.db',
            error: 'simulated failure'
        })

        const report = await buildReadinessReport()
        expect(report.status).toBe('not_ready')
        expect(mockGetReadiness).toHaveBeenCalledTimes(2)
    })

    it('expires cache after TTL elapses', async () => {
        vi.useFakeTimers()
        const { buildReadinessReport, setReadinessCacheTtl, clearReadinessCache } = await import('../monitoring/readiness.js')
        clearReadinessCache()
        setReadinessCacheTtl(100)

        mockGetReadiness.mockClear()
        mockIsRedisAvailable.mockClear()

        await buildReadinessReport()
        expect(mockGetReadiness).toHaveBeenCalledTimes(1)

        vi.advanceTimersByTime(150)

        mockGetReadiness.mockReturnValue({
            ready: false,
            databasePath: '/tmp/test.db',
            error: 'timed out'
        })

        const report = await buildReadinessReport()
        expect(report.status).toBe('not_ready')
        expect(mockGetReadiness).toHaveBeenCalledTimes(2)

        vi.useRealTimers()
    })
})
