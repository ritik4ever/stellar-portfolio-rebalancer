/**
 * Heartbeat supervisor activation in the worker runtime (#1194).
 *
 * The supervisor primitives live in `workerHeartbeat.ts`. These tests cover the
 * runtime wiring: a restart handler is registered for every supervised worker,
 * the supervisor loop restarts workers that stop sending heartbeats, and
 * crash-loop protection bounds the number of restarts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    logAudit: vi.fn(),
}))

vi.mock('../db/client.js', () => ({
    query: vi.fn(),
}))

vi.mock('../queue/queues.js', () => ({
    getDLQQueue: vi.fn(() => null),
}))

// Worker modules are mocked so the tests exercise only the runtime wiring and
// never construct real BullMQ workers. Each mock exposes the start/stop pair
// the runtime and the restart handlers call.
const fakeWorker = () => ({ close: vi.fn().mockResolvedValue(undefined) })

vi.mock('../queue/workers/portfolioCheckWorker.js', () => ({
    startPortfolioCheckWorker: vi.fn(() => fakeWorker()),
    stopPortfolioCheckWorker: vi.fn(async () => {}),
}))

vi.mock('../queue/workers/rebalanceWorker.js', () => ({
    startRebalanceWorker: vi.fn(() => fakeWorker()),
    stopRebalanceWorker: vi.fn(async () => {}),
}))

vi.mock('../queue/workers/analyticsSnapshotWorker.js', () => ({
    startAnalyticsSnapshotWorker: vi.fn(() => fakeWorker()),
    stopAnalyticsSnapshotWorker: vi.fn(async () => {}),
}))

vi.mock('../queue/workers/analyticsCompactionWorker.js', () => ({
    startAnalyticsCompactionWorker: vi.fn(() => fakeWorker()),
    stopAnalyticsCompactionWorker: vi.fn(async () => {}),
}))

vi.mock('../queue/workers/idempotencyCleanupWorker.js', () => ({
    startIdempotencyCleanupWorker: vi.fn(() => fakeWorker()),
    stopIdempotencyCleanupWorker: vi.fn(async () => {}),
}))

vi.mock('../queue/workers/portfolioExportWorker.js', () => ({
    startPortfolioExportWorker: vi.fn(() => fakeWorker()),
    stopPortfolioExportWorker: vi.fn(async () => {}),
}))

vi.mock('../queue/workers/userAlertsWorker.js', () => ({
    startUserAlertsWorker: vi.fn(() => fakeWorker()),
    stopUserAlertsWorker: vi.fn(async () => {}),
}))

vi.mock('../queue/workers/scheduledExportWorker.js', () => ({
    startScheduledExportWorker: vi.fn(() => fakeWorker()),
    stopScheduledExportWorker: vi.fn(async () => {}),
}))

vi.mock('../queue/workers/priceHistoryWorker.js', () => ({
    startPriceHistoryWorkers: vi.fn(),
    stopPriceHistoryWorkers: vi.fn(async () => {}),
}))

const SUPERVISED_WORKERS = [
    'analytics-compaction',
    'analytics-snapshot',
    'idempotency-cleanup',
    'portfolio-check',
    'portfolio-export',
    'rebalance',
    'scheduled-export',
    'user-alerts',
]

const SUPERVISOR_ENV_KEYS = [
    'WORKER_SUPERVISOR_ENABLED',
    'WORKER_SUPERVISOR_INTERVAL_MS',
    'WORKER_SUPERVISOR_MISSED_HEARTBEATS',
    'WORKER_SUPERVISOR_MAX_RESTARTS',
    'WORKER_SUPERVISOR_RESTART_WINDOW_MS',
]

async function loadRuntime() {
    return import('../queue/workers/workerRuntime.js')
}

async function loadSupervisor() {
    return import('../queue/workers/workerHeartbeat.js')
}

function clearSupervisorEnv() {
    for (const key of SUPERVISOR_ENV_KEYS) delete process.env[key]
}

describe('Heartbeat supervisor activation in worker runtime (#1194)', () => {
    beforeEach(async () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
        clearSupervisorEnv()
        const { clearWorkerRestartHandlers, resetWorkerSupervisorState, stopWorkerSupervisor, clearAllWorkerStatus } =
            await loadSupervisor()
        stopWorkerSupervisor()
        clearWorkerRestartHandlers()
        resetWorkerSupervisorState()
        await clearAllWorkerStatus()
        vi.clearAllMocks()
    })

    afterEach(async () => {
        const { stopWorkerSupervisor, clearWorkerRestartHandlers, resetWorkerSupervisorState, clearAllWorkerStatus } =
            await loadSupervisor()
        stopWorkerSupervisor()
        clearWorkerRestartHandlers()
        resetWorkerSupervisorState()
        await clearAllWorkerStatus()
        clearSupervisorEnv()
        vi.useRealTimers()
    })

    it('registers a restart handler for every supervised worker on startup', async () => {
        const { startAllWorkers, getSupervisedWorkerNames, registerDefaultWorkerRestartHandlers } = await loadRuntime()
        const { getRegisteredRestartHandlers } = await loadSupervisor()

        expect(getSupervisedWorkerNames().sort()).toEqual(SUPERVISED_WORKERS)
        expect(registerDefaultWorkerRestartHandlers().sort()).toEqual(SUPERVISED_WORKERS)

        await startAllWorkers()

        expect(getRegisteredRestartHandlers().sort()).toEqual(SUPERVISED_WORKERS)
    })

    it('routes the supervisor restart action to stop-then-start of the affected worker', async () => {
        const { startAllWorkers } = await loadRuntime()
        const { superviseWorker } = await loadSupervisor()
        const portfolioCheck = await import('../queue/workers/portfolioCheckWorker.js')

        await startAllWorkers()
        expect(portfolioCheck.startPortfolioCheckWorker).toHaveBeenCalledTimes(1)

        const result = await superviseWorker('portfolio-check', { missedHeartbeatThreshold: 1 })

        expect(result.action).toBe('restart_triggered')
        expect(portfolioCheck.stopPortfolioCheckWorker).toHaveBeenCalledTimes(1)
        expect(portfolioCheck.startPortfolioCheckWorker).toHaveBeenCalledTimes(2)
        expect(vi.mocked(portfolioCheck.stopPortfolioCheckWorker).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(portfolioCheck.startPortfolioCheckWorker).mock.invocationCallOrder[1],
        )
    })

    it('automatically restarts a worker that stops sending heartbeats, bounded by crash-loop protection', async () => {
        process.env.WORKER_SUPERVISOR_INTERVAL_MS = '10000'
        process.env.WORKER_SUPERVISOR_MISSED_HEARTBEATS = '1'
        process.env.WORKER_SUPERVISOR_MAX_RESTARTS = '2'
        process.env.WORKER_SUPERVISOR_RESTART_WINDOW_MS = '600000'

        const { startAllWorkers } = await loadRuntime()
        const portfolioCheck = await import('../queue/workers/portfolioCheckWorker.js')

        await startAllWorkers()

        // Five supervisor sweeps with no heartbeats persisted for the worker.
        await vi.advanceTimersByTimeAsync(50_000)

        // Two supervised restarts happen, then crash-loop protection blocks the rest.
        expect(portfolioCheck.stopPortfolioCheckWorker).toHaveBeenCalledTimes(2)
        expect(portfolioCheck.startPortfolioCheckWorker).toHaveBeenCalledTimes(3)
    })

    it('stops supervising and unregisters handlers after a graceful shutdown', async () => {
        process.env.WORKER_SUPERVISOR_INTERVAL_MS = '10000'
        process.env.WORKER_SUPERVISOR_MISSED_HEARTBEATS = '1'

        const { startAllWorkers, stopAllWorkers } = await loadRuntime()
        const { getRegisteredRestartHandlers, getWorkerSupervisorState } = await loadSupervisor()
        const portfolioCheck = await import('../queue/workers/portfolioCheckWorker.js')

        await startAllWorkers()
        await stopAllWorkers()

        expect(getRegisteredRestartHandlers()).toEqual([])

        const stopsAfterShutdown = vi.mocked(portfolioCheck.stopPortfolioCheckWorker).mock.calls.length
        await vi.advanceTimersByTimeAsync(60_000)

        expect(portfolioCheck.stopPortfolioCheckWorker).toHaveBeenCalledTimes(stopsAfterShutdown)
        expect(getWorkerSupervisorState('portfolio-check').restartTimestamps).toHaveLength(0)
    })

    it('does not supervise when the supervisor is disabled by configuration', async () => {
        process.env.WORKER_SUPERVISOR_ENABLED = 'false'

        const { startAllWorkers, isWorkerSupervisorEnabled } = await loadRuntime()
        const { getRegisteredRestartHandlers, getWorkerSupervisorState } = await loadSupervisor()

        expect(isWorkerSupervisorEnabled()).toBe(false)

        await startAllWorkers()
        expect(getRegisteredRestartHandlers()).toEqual([])

        await vi.advanceTimersByTimeAsync(300_000)
        expect(getWorkerSupervisorState('portfolio-check').restartTimestamps).toHaveLength(0)
    })
})
