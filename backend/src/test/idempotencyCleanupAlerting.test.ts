import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const mockCleanup = vi.fn()
const mockRecordRun = vi.fn()
const mockSendAlert = vi.fn().mockResolvedValue(undefined)
const mockLoggerInfo = vi.fn()
const mockLoggerError = vi.fn()
const mockLoggerWarn = vi.fn()

vi.mock('../db/idempotencyDb.js', () => ({
  dbCleanupExpiredIdempotencyKeys: mockCleanup,
}))
vi.mock('../observability/metrics.js', () => ({
  recordIdempotencyCleanupRun: mockRecordRun,
}))
vi.mock('../observability/operationalAlerts.js', () => ({
  sendOperationalAlert: mockSendAlert,
}))
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
  },
  logAudit: vi.fn(),
}))
vi.mock('../queue/workers/workerRuntime.js', () => ({
  createWorkerRuntimeStatus: () => ({ name: 'idempotency-cleanup', concurrency: 1 }),
  markWorkerFailed: vi.fn(),
  markWorkerJobCompleted: vi.fn(),
  markWorkerJobFailed: vi.fn(),
  markWorkerReady: vi.fn(),
  markWorkerStarting: vi.fn(),
  markWorkerStopped: vi.fn(),
  snapshotWorkerRuntimeStatus: vi.fn(),
  handleFinalFailure: vi.fn(),
}))

describe('idempotency cleanup metrics, alerting, and dead-man switch', () => {
  beforeEach(async () => {
    mockCleanup.mockReset()
    mockRecordRun.mockReset()
    mockSendAlert.mockClear()
    mockLoggerInfo.mockReset()
    mockLoggerError.mockReset()
    mockLoggerWarn.mockReset()
    delete process.env.IDEMPOTENCY_CLEANUP_FAILURE_ALERT_THRESHOLD
    delete process.env.IDEMPOTENCY_CLEANUP_EXPECTED_INTERVAL_MS

    const { resetIdempotencyCleanupStateForTest } = await import('../queue/workers/idempotencyCleanupWorker.js')
    resetIdempotencyCleanupStateForTest()
  })

  afterEach(() => {
    delete process.env.IDEMPOTENCY_CLEANUP_FAILURE_ALERT_THRESHOLD
    delete process.env.IDEMPOTENCY_CLEANUP_EXPECTED_INTERVAL_MS
  })

  describe('successful runs', () => {
    it('emits success metric and logs recordsCleaned count', async () => {
      mockCleanup.mockReturnValue(7)
      const { processIdempotencyCleanupJob, getConsecutiveCleanupFailures } = await import(
        '../queue/workers/idempotencyCleanupWorker.js'
      )

      await processIdempotencyCleanupJob({ id: 'job-success', data: { triggeredBy: 'scheduler' } } as any)

      expect(mockRecordRun).toHaveBeenCalledTimes(1)
      expect(mockRecordRun).toHaveBeenCalledWith(true, 7, 0)
      expect(getConsecutiveCleanupFailures()).toBe(0)
      expect(mockSendAlert).not.toHaveBeenCalled()

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        '[WORKER:idempotency-cleanup] Cleanup complete',
        expect.objectContaining({
          jobId: 'job-success',
          outcome: 'success',
          recordsCleaned: 7,
          expiredKeysRemoved: 7,
          consecutiveFailures: 0,
        }),
      )
    })
  })

  describe('consecutive failures and alerting pipeline', () => {
    it('records failure metric on single failure and does not alert when below threshold', async () => {
      process.env.IDEMPOTENCY_CLEANUP_FAILURE_ALERT_THRESHOLD = '3'
      mockCleanup.mockImplementation(() => {
        throw new Error('SQLite locked')
      })
      const { processIdempotencyCleanupJob, getConsecutiveCleanupFailures } = await import(
        '../queue/workers/idempotencyCleanupWorker.js'
      )

      await expect(
        processIdempotencyCleanupJob({ id: 'job-fail-1', data: {} } as any),
      ).rejects.toThrow('SQLite locked')

      expect(mockRecordRun).toHaveBeenCalledWith(false, 0, 1)
      expect(getConsecutiveCleanupFailures()).toBe(1)
      expect(mockSendAlert).not.toHaveBeenCalled()

      expect(mockLoggerError).toHaveBeenCalledWith(
        '[WORKER:idempotency-cleanup] Cleanup failed',
        expect.objectContaining({
          jobId: 'job-fail-1',
          outcome: 'failure',
          recordsCleaned: 0,
          consecutiveFailures: 1,
          error: 'SQLite locked',
        }),
      )
    })

    it('triggers operational alert when consecutive failures reach configured threshold', async () => {
      process.env.IDEMPOTENCY_CLEANUP_FAILURE_ALERT_THRESHOLD = '3'
      mockCleanup.mockImplementation(() => {
        throw new Error('disk full')
      })
      const { processIdempotencyCleanupJob, getConsecutiveCleanupFailures } = await import(
        '../queue/workers/idempotencyCleanupWorker.js'
      )

      // 1st failure: no alert
      await expect(processIdempotencyCleanupJob({ id: 'job-1', data: {} } as any)).rejects.toThrow('disk full')
      expect(mockRecordRun).toHaveBeenLastCalledWith(false, 0, 1)
      expect(mockSendAlert).not.toHaveBeenCalled()

      // 2nd failure: no alert
      await expect(processIdempotencyCleanupJob({ id: 'job-2', data: {} } as any)).rejects.toThrow('disk full')
      expect(mockRecordRun).toHaveBeenLastCalledWith(false, 0, 2)
      expect(mockSendAlert).not.toHaveBeenCalled()

      // 3rd failure: alert triggered
      await expect(processIdempotencyCleanupJob({ id: 'job-3', data: {} } as any)).rejects.toThrow('disk full')
      expect(mockRecordRun).toHaveBeenLastCalledWith(false, 0, 3)
      expect(getConsecutiveCleanupFailures()).toBe(3)
      expect(mockSendAlert).toHaveBeenCalledTimes(1)
      expect(mockSendAlert).toHaveBeenCalledWith(
        'Idempotency cleanup is repeatedly failing',
        expect.objectContaining({
          consecutiveFailures: 3,
          jobId: 'job-3',
          error: 'disk full',
        }),
      )
    })

    it('resets consecutive failures counter upon successful recovery', async () => {
      process.env.IDEMPOTENCY_CLEANUP_FAILURE_ALERT_THRESHOLD = '2'
      const { processIdempotencyCleanupJob, getConsecutiveCleanupFailures } = await import(
        '../queue/workers/idempotencyCleanupWorker.js'
      )

      // 1 failure
      mockCleanup.mockImplementationOnce(() => {
        throw new Error('transient timeout')
      })
      await expect(processIdempotencyCleanupJob({ id: 'job-fail', data: {} } as any)).rejects.toThrow()
      expect(getConsecutiveCleanupFailures()).toBe(1)
      expect(mockSendAlert).not.toHaveBeenCalled()

      // Followed by success
      mockCleanup.mockReturnValue(3)
      await processIdempotencyCleanupJob({ id: 'job-recovered', data: {} } as any)
      expect(getConsecutiveCleanupFailures()).toBe(0)
      expect(mockRecordRun).toHaveBeenLastCalledWith(true, 3, 0)
      expect(mockSendAlert).not.toHaveBeenCalled()

      // Next failure should be back at count 1 (threshold 2 not reached)
      mockCleanup.mockImplementationOnce(() => {
        throw new Error('second failure')
      })
      await expect(processIdempotencyCleanupJob({ id: 'job-fail-again', data: {} } as any)).rejects.toThrow()
      expect(getConsecutiveCleanupFailures()).toBe(1)
      expect(mockSendAlert).not.toHaveBeenCalled()
    })
  })

  describe('dead-man switch check', () => {
    it('returns false and does not alert when worker runs within expected interval', async () => {
      process.env.IDEMPOTENCY_CLEANUP_EXPECTED_INTERVAL_MS = '60000'
      const { checkIdempotencyCleanupDeadMan, processIdempotencyCleanupJob } = await import(
        '../queue/workers/idempotencyCleanupWorker.js'
      )

      const baseTime = 1_000_000
      mockCleanup.mockReturnValue(0)
      // Simulate run at baseTime
      vi.spyOn(Date, 'now').mockReturnValue(baseTime)
      await processIdempotencyCleanupJob({ id: 'job-run', data: {} } as any)

      // Check after 1 interval (60s): not overdue (threshold is 2x interval = 120s)
      const overdue = await checkIdempotencyCleanupDeadMan(baseTime + 60_000)
      expect(overdue).toBe(false)
      expect(mockSendAlert).not.toHaveBeenCalled()
    })

    it('returns true and triggers alert when worker missed expected interval', async () => {
      process.env.IDEMPOTENCY_CLEANUP_EXPECTED_INTERVAL_MS = '60000'
      const { checkIdempotencyCleanupDeadMan, processIdempotencyCleanupJob } = await import(
        '../queue/workers/idempotencyCleanupWorker.js'
      )

      const baseTime = 1_000_000
      mockCleanup.mockReturnValue(0)
      vi.spyOn(Date, 'now').mockReturnValue(baseTime)
      await processIdempotencyCleanupJob({ id: 'job-run', data: {} } as any)

      // Check after 2.5 intervals (150s > 120s): overdue
      const overdue = await checkIdempotencyCleanupDeadMan(baseTime + 150_000)
      expect(overdue).toBe(true)
      expect(mockSendAlert).toHaveBeenCalledTimes(1)
      expect(mockSendAlert).toHaveBeenCalledWith(
        'Idempotency cleanup worker missed its expected interval',
        expect.objectContaining({
          expectedIntervalMs: 60000,
          overdueByMs: 150_000,
        }),
      )
    })

    it('suppresses duplicate dead-man alerts within cooldown period', async () => {
      process.env.IDEMPOTENCY_CLEANUP_EXPECTED_INTERVAL_MS = '60000'
      const { checkIdempotencyCleanupDeadMan, processIdempotencyCleanupJob } = await import(
        '../queue/workers/idempotencyCleanupWorker.js'
      )

      const baseTime = 1_000_000
      mockCleanup.mockReturnValue(0)
      vi.spyOn(Date, 'now').mockReturnValue(baseTime)
      await processIdempotencyCleanupJob({ id: 'job-run', data: {} } as any)

      // First overdue check triggers alert
      await checkIdempotencyCleanupDeadMan(baseTime + 150_000)
      expect(mockSendAlert).toHaveBeenCalledTimes(1)

      // Second check 10 seconds later: still overdue, but within cooldown (< 60s since last alert)
      const overdueSecond = await checkIdempotencyCleanupDeadMan(baseTime + 160_000)
      expect(overdueSecond).toBe(true)
      expect(mockSendAlert).toHaveBeenCalledTimes(1) // Still 1

      // Third check after cooldown period: triggers second alert
      const overdueThird = await checkIdempotencyCleanupDeadMan(baseTime + 220_000)
      expect(overdueThird).toBe(true)
      expect(mockSendAlert).toHaveBeenCalledTimes(2)
    })
  })
})
