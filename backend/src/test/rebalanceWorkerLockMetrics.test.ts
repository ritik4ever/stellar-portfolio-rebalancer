import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Job } from 'bullmq'

// ─── Mocks ───────────────────────────────────────────────────────────────────

const {
    mockAcquireWorkerLock,
    mockReleaseWorkerLock,
    mockRecordRebalanceWorkerLockAcquisition,
    mockLoggerWarn,
} = vi.hoisted(() => ({
    mockAcquireWorkerLock: vi.fn(),
    mockReleaseWorkerLock: vi.fn().mockResolvedValue(undefined),
    mockRecordRebalanceWorkerLockAcquisition: vi.fn(),
    mockLoggerWarn: vi.fn(),
}))

vi.mock('../queue/workers/workerRuntime.js', () => ({
    acquireWorkerLock: mockAcquireWorkerLock,
    releaseWorkerLock: mockReleaseWorkerLock,
    createWorkerRuntimeStatus: vi.fn().mockReturnValue({}),
    markWorkerFailed: vi.fn(),
    markWorkerJobCompleted: vi.fn(),
    markWorkerJobFailed: vi.fn(),
    markWorkerReady: vi.fn(),
    markWorkerStarting: vi.fn(),
    markWorkerStopped: vi.fn(),
    snapshotWorkerRuntimeStatus: vi.fn(),
    handleFinalFailure: vi.fn(),
}))

vi.mock('../observability/metrics.js', () => ({
    recordRebalanceWorkerLockAcquisition: mockRecordRebalanceWorkerLockAcquisition,
}))

vi.mock('../utils/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warn: mockLoggerWarn,
        error: vi.fn(),
    },
    logAudit: vi.fn(),
}))

vi.mock('../services/stellar.js', () => {
    function StellarService(this: any) {}
    StellarService.prototype.getPortfolio = vi.fn().mockResolvedValue({
        id: 'portfolio-1',
        userAddress: 'GTEST',
    })
    StellarService.prototype.executeRebalance = vi.fn().mockResolvedValue({ trades: 1, gasUsed: '0.01 XLM' })
    return { StellarService }
})

vi.mock('../services/serviceContainer.js', () => ({
    rebalanceHistoryService: {
        recordRebalanceEvent: vi.fn().mockResolvedValue({ id: 'hist-1' }),
    },
}))

vi.mock('../services/notificationService.js', () => ({
    notificationService: { notify: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('../services/websocket.service.js', () => ({
    broadcastPortfolioEvent: vi.fn(),
}))

vi.mock('../queue/connection.js', () => ({
    getConnectionOptions: vi.fn().mockReturnValue({}),
}))

vi.mock('../config/rebalanceLockConfig.js', () => ({
    getRebalanceLockConfig: vi.fn().mockReturnValue({ ttlMs: 300000, lockWaitWarnMs: 50 }),
}))

import { processRebalanceJob } from '../queue/workers/rebalanceWorker.js'

function mockJob<T>(data: T, id = 'job-1', attemptsMade = 0): Job<T> {
    return { id, data, attemptsMade } as unknown as Job<T>
}

describe('rebalanceWorker lock acquisition instrumentation', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('records an acquired-lock metric on the immediate-acquire path', async () => {
        mockAcquireWorkerLock.mockResolvedValue(true)

        await processRebalanceJob(mockJob({ portfolioId: 'portfolio-1', triggeredBy: 'manual' as const }))

        expect(mockRecordRebalanceWorkerLockAcquisition).toHaveBeenCalledTimes(1)
        const [portfolioId, waitSeconds, acquired] = mockRecordRebalanceWorkerLockAcquisition.mock.calls[0]
        expect(portfolioId).toBe('portfolio-1')
        expect(typeof waitSeconds).toBe('number')
        expect(waitSeconds).toBeGreaterThanOrEqual(0)
        expect(acquired).toBe(true)
        expect(mockReleaseWorkerLock).toHaveBeenCalledWith('portfolio-1')
    })

    it('records a contended-lock metric and aborts without executing when the lock is already held', async () => {
        mockAcquireWorkerLock.mockResolvedValue(false)

        await processRebalanceJob(mockJob({ portfolioId: 'portfolio-1', triggeredBy: 'manual' as const }))

        expect(mockRecordRebalanceWorkerLockAcquisition).toHaveBeenCalledTimes(1)
        const [portfolioId, , acquired] = mockRecordRebalanceWorkerLockAcquisition.mock.calls[0]
        expect(portfolioId).toBe('portfolio-1')
        expect(acquired).toBe(false)
        // Should not proceed to release a lock it never held.
        expect(mockReleaseWorkerLock).not.toHaveBeenCalled()
    })

    it('logs a warning when lock acquisition exceeds the configured threshold', async () => {
        mockAcquireWorkerLock.mockImplementation(async () => {
            await new Promise((resolve) => setTimeout(resolve, 60))
            return true
        })

        await processRebalanceJob(mockJob({ portfolioId: 'portfolio-1', triggeredBy: 'manual' as const }))

        expect(mockLoggerWarn).toHaveBeenCalledWith(
            expect.stringContaining('Lock acquisition took longer than expected'),
            expect.objectContaining({ portfolioId: 'portfolio-1' }),
        )
    })

    it('does not log a warning when lock acquisition is fast', async () => {
        mockAcquireWorkerLock.mockResolvedValue(true)

        await processRebalanceJob(mockJob({ portfolioId: 'portfolio-1', triggeredBy: 'manual' as const }))

        expect(mockLoggerWarn).not.toHaveBeenCalled()
    })
})
