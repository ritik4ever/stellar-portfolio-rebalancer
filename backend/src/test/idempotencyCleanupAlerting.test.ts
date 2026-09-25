import { beforeEach, describe, expect, it, vi } from 'vitest'

const cleanup = vi.fn()
const recordRun = vi.fn()
const alert = vi.fn().mockResolvedValue(undefined)
vi.mock('../db/idempotencyDb.js', () => ({ dbCleanupExpiredIdempotencyKeys: cleanup }))
vi.mock('../observability/metrics.js', () => ({ recordIdempotencyCleanupRun: recordRun }))
vi.mock('../observability/operationalAlerts.js', () => ({ sendOperationalAlert: alert }))
vi.mock('../queue/workers/workerRuntime.js', () => ({
  createWorkerRuntimeStatus: () => ({}), markWorkerFailed: vi.fn(), markWorkerJobCompleted: vi.fn(),
  markWorkerJobFailed: vi.fn(), markWorkerReady: vi.fn(), markWorkerStarting: vi.fn(), markWorkerStopped: vi.fn(),
  snapshotWorkerRuntimeStatus: vi.fn(), handleFinalFailure: vi.fn(),
}))

describe('idempotency cleanup alerting', () => {
  beforeEach(() => { vi.resetModules(); cleanup.mockReset(); recordRun.mockReset(); alert.mockClear(); process.env.IDEMPOTENCY_CLEANUP_FAILURE_ALERT_THRESHOLD = '1' })
  it('records failure metrics and alerts after repeated failures', async () => {
    cleanup.mockImplementation(() => { throw new Error('database unavailable') })
    const { processIdempotencyCleanupJob } = await import('../queue/workers/idempotencyCleanupWorker.js')
    await expect(processIdempotencyCleanupJob({ id: 'job-1', data: {} } as any)).rejects.toThrow('database unavailable')
    expect(recordRun).toHaveBeenCalledWith(false, 0, 1)
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('repeatedly failing'), expect.objectContaining({ consecutiveFailures: 1 }))
  })
})
