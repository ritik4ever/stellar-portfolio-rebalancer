/**
 * Per-portfolio advisory-lock contention metrics (#1399).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    logAudit: vi.fn(),
}))

vi.mock('../observability/tracing.js', () => ({
    getTraceId: () => undefined,
    getSpanId: () => undefined,
}))

vi.mock('../queue/workers/workerHeartbeat.js', () => ({
    persistWorkerStatus: vi.fn(),
}))

vi.mock('../queue/queues.js', () => ({
    getDLQQueue: vi.fn(() => null),
}))

// Cut the worker graph: workerRuntime only needs these for startAllWorkers().
// Importing the real modules would pull in portfolioStorage → better-sqlite3,
// the Stellar SDK, etc. See #1399.
vi.mock('../queue/workers/portfolioCheckWorker.js', () => ({
    startPortfolioCheckWorker: vi.fn(() => null),
}))

vi.mock('../queue/workers/rebalanceWorker.js', () => ({
    startRebalanceWorker: vi.fn(() => null),
}))

vi.mock('../queue/workers/analyticsSnapshotWorker.js', () => ({
    startAnalyticsSnapshotWorker: vi.fn(() => null),
}))

vi.mock('../queue/workers/analyticsCompactionWorker.js', () => ({
    startAnalyticsCompactionWorker: vi.fn(() => null),
}))

vi.mock('../queue/workers/idempotencyCleanupWorker.js', () => ({
    startIdempotencyCleanupWorker: vi.fn(() => null),
}))

vi.mock('../queue/workers/portfolioExportWorker.js', () => ({
    startPortfolioExportWorker: vi.fn(() => null),
}))

vi.mock('../queue/workers/userAlertsWorker.js', () => ({
    startUserAlertsWorker: vi.fn(() => null),
}))

vi.mock('../queue/workers/scheduledExportWorker.js', () => ({
    startScheduledExportWorker: vi.fn(() => null),
}))

vi.mock('../queue/workers/priceHistoryWorker.js', () => ({
    startPriceHistoryWorkers: vi.fn(),
    stopPriceHistoryWorkers: vi.fn(),
}))

const queryMock = vi.fn()

vi.mock('../db/client.js', () => ({
    query: (...args: unknown[]) => queryMock(...args),
}))

async function metricValues(metric: string, labels: Record<string, string>): Promise<number[]> {
    const { getMetricsPayload } = await import('../observability/metrics.js')
    const payload = await getMetricsPayload()
    const wanted = Object.entries(labels).map(([k, v]) => `${k}="${v}"`)
    const values: number[] = []
    for (const line of payload.split('\n')) {
        if (line.startsWith('#') || !line.startsWith(metric)) continue
        const match = line.match(/^[^{\s]+\{([^}]*)\}\s+(\S+)$/)
        if (!match) continue
        const present = match[1].split(',').map((s) => s.trim())
        if (wanted.every((w) => present.includes(w))) values.push(Number(match[2]))
    }
    return values
}

async function contentionCount(bucket: string): Promise<number> {
    const v = await metricValues('stellar_portfolio_rebalance_lock_contention_count', { portfolio_bucket: bucket })
    return v.reduce((s, x) => s + x, 0)
}

async function waitSampleCount(bucket: string, outcome: string): Promise<number> {
    const v = await metricValues('stellar_portfolio_rebalance_lock_wait_seconds_count', { portfolio_bucket: bucket, outcome })
    return v.reduce((s, x) => s + x, 0)
}

describe('worker lock contention metrics (#1399)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        queryMock.mockReset()
        delete process.env.REBALANCE_LOCK_WAIT_WARN_MS
    })

    afterEach(() => {
        delete process.env.REBALANCE_LOCK_WAIT_WARN_MS
    })

    it('records wait time without contention on immediate acquire', async () => {
        queryMock.mockResolvedValue({ rows: [{ locked: true }] })
        const { acquireWorkerLock } = await import('../queue/workers/workerRuntime.js')
        const { bucketPortfolioId } = await import('../observability/metrics.js')
        const bucket = bucketPortfolioId('portfolio-fast')
        const cBefore = await contentionCount(bucket)
        const aBefore = await waitSampleCount(bucket, 'acquired')
        expect(await acquireWorkerLock('portfolio-fast')).toBe(true)
        expect(await contentionCount(bucket)).toBe(cBefore)
        expect(await waitSampleCount(bucket, 'acquired')).toBe(aBefore + 1)
    })

    it('records contention on the lock-already-held path', async () => {
        queryMock.mockResolvedValue({ rows: [{ locked: false }] })
        const { acquireWorkerLock } = await import('../queue/workers/workerRuntime.js')
        const { bucketPortfolioId } = await import('../observability/metrics.js')
        const bucket = bucketPortfolioId('portfolio-hot')
        const cBefore = await contentionCount(bucket)
        const wBefore = await waitSampleCount(bucket, 'contended')
        expect(await acquireWorkerLock('portfolio-hot')).toBe(false)
        expect(await contentionCount(bucket)).toBe(cBefore + 1)
        expect(await waitSampleCount(bucket, 'contended')).toBe(wBefore + 1)
    })

    it('warns when wait exceeds the configurable threshold', async () => {
        process.env.REBALANCE_LOCK_WAIT_WARN_MS = '10'
        queryMock.mockImplementation(() => new Promise((r) => setTimeout(() => r({ rows: [{ locked: true }] }), 50)))
        const { acquireWorkerLock } = await import('../queue/workers/workerRuntime.js')
        const { logger } = await import('../utils/logger.js')
        expect(await acquireWorkerLock('portfolio-slow')).toBe(true)
        const warn = logger.warn as ReturnType<typeof vi.fn>
        expect(warn).toHaveBeenCalledWith(
            '[LOCK] Slow lock acquisition — possible stuck lock',
            expect.objectContaining({ portfolioId: 'portfolio-slow', acquired: true }),
        )
        const meta = warn.mock.calls[0][1] as { waitMs: number; waitWarnMs: number }
        expect(meta.waitMs).toBeGreaterThan(10)
        expect(meta.waitWarnMs).toBe(10)
    })

    it('stays quiet when acquisition is under the threshold', async () => {
        process.env.REBALANCE_LOCK_WAIT_WARN_MS = '10000'
        queryMock.mockResolvedValue({ rows: [{ locked: true }] })
        const { acquireWorkerLock } = await import('../queue/workers/workerRuntime.js')
        const { logger } = await import('../utils/logger.js')
        expect(await acquireWorkerLock('portfolio-ok')).toBe(true)
        expect(logger.warn as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
    })

    it('buckets portfolio ids into a bounded label set', async () => {
        const { bucketPortfolioId } = await import('../observability/metrics.js')
        for (const id of ['a', 'GABC123', 'portfolio-1', 'demo']) {
            expect(bucketPortfolioId(id)).toMatch(/^[0-9a-f]{2}$/)
        }
        expect(bucketPortfolioId('portfolio-1')).toBe(bucketPortfolioId('portfolio-1'))
    })
})